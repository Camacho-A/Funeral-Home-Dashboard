import type { DataAdapterMode } from '@/lib/env';
import { queryWixDataItems, updateWixDataItem, WixDataApiError } from '@/lib/wixDataApi';
import { decryptCalendarToken, encryptCalendarToken } from '@/lib/identity/calendarTokenEncryption';
import { generateOAuthState, generatePkcePair, signOAuthStateCookie, verifyOAuthStateCookie } from '@/lib/auth/calendarOAuthState';

/**
 * Send to Crematory (2026-10). The organization's ONE shared Microsoft 365
 * mailbox that Crematory Packages are emailed from. An administrator signs
 * in to Microsoft as that mailbox once (Settings → Crematory); every send
 * then goes from it, and SOLIS records which staff member pressed Send.
 *
 * Uses the same Microsoft app registration as calendar sync
 * (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET), with its own callback
 * (MICROSOFT_MAIL_REDIRECT_URI) and its own scopes: Mail.ReadWrite (to
 * build the draft and attach the PDFs) and Mail.Send. Tokens are encrypted
 * exactly like calendar tokens (CALENDAR_TOKEN_ENCRYPTION_KEY).
 *
 * The connection is stored on the organization's Wix row in its own field,
 * `crematoryMailboxJson`, which the organization mapper never reads — so
 * the tokens can never reach the browser through the organization record.
 */
const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPES = ['Mail.ReadWrite', 'Mail.Send', 'offline_access', 'openid', 'profile', 'email'];
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
export const MAILBOX_OAUTH_COOKIE_NAME = 'beacon_crematory_mailbox_oauth_state';

export class CrematoryMailboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CrematoryMailboxError';
  }
}

/**
 * Connection diagnostics (2026-10). Connecting the mailbox runs four steps
 * after Microsoft sends the administrator back; a failure in any of them
 * used to surface only as "The mailbox could not be connected", with
 * nothing logged. Each step now fails with its own error and one
 * structured log line naming the operation, the step, an error category
 * and an HTTP status — never a token, code, secret, password, email
 * address or provider message.
 */
export type MailboxConnectStage = 'token_exchange' | 'mailbox_lookup' | 'token_encryption' | 'save_settings';

export type MailboxDiagnostic = {
  operation: 'mailbox_connect' | 'mailbox_callback';
  stage: MailboxConnectStage | 'microsoft_authorization' | 'sign_in_state' | 'administrator_check' | 'unknown';
  /** A fixed category, or Microsoft's own OAuth error code / AADSTS number. */
  category: string;
  httpStatus: number | null;
};

/** The only way connection failures are logged. Safe fields only. */
export function logMailboxDiagnostic(diagnostic: MailboxDiagnostic): void {
  console.error(`[crematory-mailbox] ${JSON.stringify(diagnostic)}`);
}

/** Microsoft's OAuth error codes are a fixed vocabulary; anything else is reduced to "other". */
export function safeOAuthErrorCode(value: unknown): string {
  return typeof value === 'string' && /^[a-z_]{3,40}$/.test(value) ? value : 'other';
}

/** "AADSTS50194" from Microsoft's error description — the number only, never the rest of the text. */
export function aadstsCode(description: string | null | undefined): string | null {
  const match = /\bAADSTS(\d{4,6})\b/.exec(description ?? '');
  return match ? `AADSTS${match[1]}` : null;
}

export class MailboxConnectError extends CrematoryMailboxError {
  constructor(
    message: string,
    status: number,
    readonly diagnostic: MailboxDiagnostic,
  ) {
    super(message, status);
    this.name = 'MailboxConnectError';
  }
}

const connectFailure = (stage: MailboxConnectStage, category: string, httpStatus: number | null, message: string, status = 502) =>
  new MailboxConnectError(message, status, { operation: 'mailbox_connect', stage, category, httpStatus });

/** What to tell the administrator for a rejected code exchange. */
function tokenExchangeMessage(code: string): string {
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return `Microsoft rejected SOLIS's app credentials (${code}). Check that MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in Vercel are the new registration's, and that the secret has not expired.`;
  }
  if (code === 'invalid_grant') return 'The Microsoft sign-in expired or was already used (invalid_grant). Please try Connect again.';
  return `Microsoft did not complete the sign-in (${code}).`;
}

type StoredMailbox = {
  accountEmail: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  expiresAt: string;
  status: 'connected' | 'reauth_required';
  connectedBy: string;
  connectedAt: string;
};

export type CrematoryMailboxStatus =
  | { connected: false; configured: boolean }
  | { connected: true; configured: boolean; accountEmail: string; status: 'connected' | 'reauth_required'; connectedAt: string; connectedBy: string };

function oauthConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_MAIL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new CrematoryMailboxError(
      'Outlook sending is not set up yet: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_MAIL_REDIRECT_URI must be configured.',
      503,
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function isCrematoryMailboxConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_MAIL_REDIRECT_URI);
}

// ---------------------------------------------------------------------------
// Storage — the organization's own Wix row (raw field), or memory in mock mode.
// ---------------------------------------------------------------------------

// Mock mode keeps connections on globalThis so every route of the dev
// server sees the same mailbox (like services/__mocks__/mockStore.ts).
const mockMailboxes: Map<string, StoredMailbox | null> = ((globalThis as unknown as { __crematoryMockMailboxes?: Map<string, StoredMailbox | null> }).__crematoryMockMailboxes ??= new Map());

async function readStored(organizationId: string, mode: DataAdapterMode): Promise<StoredMailbox | null> {
  if (mode === 'mock') return mockMailboxes.get(organizationId) ?? null;
  const response = await queryWixDataItems<{ crematoryMailboxJson?: unknown }>('organizations', { filter: { beaconOrganizationId: organizationId }, paging: { limit: 1 } });
  const raw = response.dataItems[0]?.data.crematoryMailboxJson;
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return JSON.parse(raw) as StoredMailbox;
  } catch {
    return null;
  }
}

async function writeStored(organizationId: string, value: StoredMailbox | null, mode: DataAdapterMode): Promise<void> {
  if (mode === 'mock') {
    mockMailboxes.set(organizationId, value);
    return;
  }
  const response = await queryWixDataItems<Record<string, unknown>>('organizations', { filter: { beaconOrganizationId: organizationId }, paging: { limit: 1 } });
  const item = response.dataItems[0];
  if (!item) throw new CrematoryMailboxError('Organization not found.', 404);
  await updateWixDataItem('organizations', item.id, { ...item.data, crematoryMailboxJson: value === null ? null : JSON.stringify(value) });
}

/** For tests only. */
export function resetMockCrematoryMailboxes(): void {
  mockMailboxes.clear();
}

export async function getCrematoryMailboxStatus(organizationId: string, mode: DataAdapterMode): Promise<CrematoryMailboxStatus> {
  const configured = isCrematoryMailboxConfigured();
  const stored = await readStored(organizationId, mode);
  if (!stored) return { connected: false, configured };
  return { connected: true, configured, accountEmail: stored.accountEmail, status: stored.status, connectedAt: stored.connectedAt, connectedBy: stored.connectedBy };
}

// ---------------------------------------------------------------------------
// Connecting (administrators) — same signed state cookie + PKCE as calendars.
// ---------------------------------------------------------------------------

export function beginMailboxAuthorization(organizationId: string, identityId: string): { authorizeUrl: string; cookieValue: string } {
  const { clientId, redirectUri } = oauthConfig();
  const state = generateOAuthState();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return {
    authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`,
    // staffProfileId carries the administrator's identity id here.
    cookieValue: signOAuthStateCookie({ state, codeVerifier, organizationId, staffProfileId: identityId, provider: 'microsoft' }),
  };
}

async function tokenRequest(form: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string }> {
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  return (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
}

/** Finishes the sign-in. The signed-in account becomes the mailbox. */
export async function completeMailboxAuthorization(
  code: string,
  cookieValue: string | undefined,
  state: string,
  expectedOrganizationId: string,
  mode: DataAdapterMode,
): Promise<{ accountEmail: string }> {
  const payload = verifyOAuthStateCookie(cookieValue, state);
  if (!payload || payload.organizationId !== expectedOrganizationId) throw new CrematoryMailboxError('The Microsoft sign-in expired or did not match. Please try again.', 400);
  const { clientId, clientSecret, redirectUri } = oauthConfig();

  // 1. Code exchange.
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code,
        code_verifier: payload.codeVerifier,
        scope: SCOPES.join(' '),
      }).toString(),
    });
  } catch {
    throw connectFailure('token_exchange', 'network_error', null, 'SOLIS could not reach Microsoft to finish the sign-in. Please try again.');
  }
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token) {
    const code = body.error ? safeOAuthErrorCode(body.error) : 'no_access_token';
    throw connectFailure('token_exchange', code, response.status, tokenExchangeMessage(code));
  }
  if (!body.refresh_token) {
    throw connectFailure('token_exchange', 'no_refresh_token', response.status, 'Microsoft did not allow staying signed in (no refresh token). Check that offline_access is granted to the app in Entra.');
  }

  // 2. Which account signed in. Unchanged: a failed lookup still connects,
  //    shown as "Unknown account" — now also logged.
  let accountEmail = 'Unknown account';
  try {
    const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${body.access_token}` } });
    const me = (await meResponse.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
    accountEmail = me.mail ?? me.userPrincipalName ?? 'Unknown account';
    if (!meResponse.ok) logMailboxDiagnostic({ operation: 'mailbox_connect', stage: 'mailbox_lookup', category: 'graph_rejected', httpStatus: meResponse.status });
  } catch {
    logMailboxDiagnostic({ operation: 'mailbox_connect', stage: 'mailbox_lookup', category: 'network_error', httpStatus: null });
  }

  // 3. Encryption.
  let accessTokenCiphertext: string;
  let refreshTokenCiphertext: string;
  try {
    accessTokenCiphertext = encryptCalendarToken(body.access_token);
    refreshTokenCiphertext = encryptCalendarToken(body.refresh_token);
  } catch {
    throw connectFailure(
      'token_encryption',
      'encryption_failed',
      null,
      'Microsoft sign-in worked, but SOLIS could not secure it (token encryption failed — check CALENDAR_TOKEN_ENCRYPTION_KEY). Nothing was connected.',
      500,
    );
  }

  // 4. Saving to the organization's settings.
  try {
    await writeStored(
      payload.organizationId,
      {
        accountEmail,
        accessTokenCiphertext,
        refreshTokenCiphertext,
        expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
        status: 'connected',
        connectedBy: payload.staffProfileId,
        connectedAt: new Date().toISOString(),
      },
      mode,
    );
  } catch (error) {
    if (error instanceof WixDataApiError) {
      throw connectFailure(
        'save_settings',
        'wix_rejected',
        error.status,
        `Microsoft sign-in worked, but SOLIS could not save the mailbox to the organization settings (Wix HTTP ${error.status}). Nothing was connected.`,
        500,
      );
    }
    if (error instanceof CrematoryMailboxError) {
      throw connectFailure('save_settings', 'organization_not_found', error.status, `${error.message} Nothing was connected.`, error.status);
    }
    throw connectFailure('save_settings', 'unexpected', null, 'Microsoft sign-in worked, but SOLIS could not save the mailbox to the organization settings. Nothing was connected.', 500);
  }
  return { accountEmail };
}

export async function disconnectCrematoryMailbox(organizationId: string, mode: DataAdapterMode): Promise<void> {
  await writeStored(organizationId, null, mode);
}

/** A usable access token for the mailbox, refreshed when needed. */
export async function getCrematoryMailboxAccess(organizationId: string, mode: DataAdapterMode): Promise<{ accessToken: string; accountEmail: string }> {
  const stored = await readStored(organizationId, mode);
  if (!stored) throw new CrematoryMailboxError('No Outlook mailbox is connected for sending to the crematory. An administrator can connect one in Settings → Crematory.', 409);
  if (stored.status === 'reauth_required') throw new CrematoryMailboxError(`The Outlook mailbox ${stored.accountEmail} needs to be signed in again (Settings → Crematory).`, 409);
  if (Date.parse(stored.expiresAt) - REFRESH_BUFFER_MS > Date.now()) {
    return { accessToken: decryptCalendarToken(stored.accessTokenCiphertext), accountEmail: stored.accountEmail };
  }
  const { clientId, clientSecret } = oauthConfig();
  const body = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: decryptCalendarToken(stored.refreshTokenCiphertext),
    scope: SCOPES.join(' '),
  });
  if (!body.access_token) {
    await writeStored(organizationId, { ...stored, status: 'reauth_required' }, mode);
    throw new CrematoryMailboxError(`The Outlook mailbox ${stored.accountEmail} needs to be signed in again (Settings → Crematory).`, 409);
  }
  await writeStored(
    organizationId,
    {
      ...stored,
      accessTokenCiphertext: encryptCalendarToken(body.access_token),
      // Microsoft rotates refresh tokens on every use; keep the new one.
      refreshTokenCiphertext: encryptCalendarToken(body.refresh_token ?? decryptCalendarToken(stored.refreshTokenCiphertext)),
      expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
    },
    mode,
  );
  return { accessToken: body.access_token, accountEmail: stored.accountEmail };
}

/** For tests only: a connected mailbox without a Microsoft sign-in. */
export function connectMockCrematoryMailbox(organizationId: string, accountEmail: string, accessToken: string): void {
  mockMailboxes.set(organizationId, {
    accountEmail,
    accessTokenCiphertext: encryptCalendarToken(accessToken),
    refreshTokenCiphertext: encryptCalendarToken('refresh-token'),
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    status: 'connected',
    connectedBy: 'identity-admin',
    connectedAt: new Date().toISOString(),
  });
}
