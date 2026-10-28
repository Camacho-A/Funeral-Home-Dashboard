import type { DataAdapterMode } from '@/lib/env';
import { queryWixDataItems, updateWixDataItem } from '@/lib/wixDataApi';
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
  const body = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code,
    code_verifier: payload.codeVerifier,
    scope: SCOPES.join(' '),
  });
  if (!body.access_token || !body.refresh_token) throw new CrematoryMailboxError(`Microsoft did not complete the sign-in${body.error ? ` (${body.error})` : ''}.`, 502);
  const me = (await (await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${body.access_token}` } })).json().catch(() => ({}))) as {
    mail?: string;
    userPrincipalName?: string;
  };
  const accountEmail = me.mail ?? me.userPrincipalName ?? 'Unknown account';
  await writeStored(
    payload.organizationId,
    {
      accountEmail,
      accessTokenCiphertext: encryptCalendarToken(body.access_token),
      refreshTokenCiphertext: encryptCalendarToken(body.refresh_token),
      expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
      status: 'connected',
      connectedBy: payload.staffProfileId,
      connectedAt: new Date().toISOString(),
    },
    mode,
  );
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
