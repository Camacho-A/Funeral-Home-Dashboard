import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixCalendarConnectionItem, buildWixCalendarConnectionData, applyCalendarConnectionUpdateToWixData, type WixCalendarConnectionItem } from '../lib/wixCalendarConnectionMapper';
import type { CalendarConnection, CalendarProviderName } from '../types/calendarConnection';
import { encryptCalendarToken, decryptCalendarToken } from '../lib/identity/calendarTokenEncryption';
import { generatePkcePair, generateOAuthState, signOAuthStateCookie, verifyOAuthStateCookie } from '../lib/auth/calendarOAuthState';
import { googleCalendarProvider } from './calendar/googleCalendarProvider';
import { microsoftCalendarProvider } from './calendar/microsoftCalendarProvider';
import type { CalendarProvider } from './calendar/calendarProvider';
import { assertStaffProfileIsActiveAndInOrganization, getById as getStaffProfileById, StaffAssignmentError } from './staffProfileService';
import { recordCalendarConnected, recordCalendarDisconnected, type ActivityContext } from './activityService';
import { calendarConnectionFixtures } from './__mocks__/calendarFixtures';
import crypto from 'crypto';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). The sole writer of `calendarConnections` — mirrors
 * `notificationService.ts`'s "one file, one collection" ownership
 * discipline. The only file (alongside `calendarSyncService.ts`) that
 * imports `googleCalendarProvider.ts`/`microsoftCalendarProvider.ts`
 * directly — `SchedulingService` and every UI component reach a
 * calendar provider only through this file's own exports, never
 * directly (invariants #9/#11, structurally enforced — see this
 * file's own structural test).
 *
 * OAuth tokens are decrypted only inside `getValidAccessToken` (the one
 * function that ever exposes a plaintext access token, and only for
 * the duration of a single provider call by its caller) — every other
 * function here reads/writes ciphertext exclusively. See
 * `lib/identity/calendarTokenEncryption.ts` and
 * docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md.
 */

export class CalendarConnectionServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

function getProviderAdapter(provider: CalendarProviderName): CalendarProvider {
  return provider === 'google' ? googleCalendarProvider : microsoftCalendarProvider;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function findConnectionById(id: string, dataAdapterMode: DataAdapterMode): Promise<CalendarConnection | null> {
  if (dataAdapterMode === 'mock') {
    return calendarConnectionFixtures.find((c) => c.id === id) ?? null;
  }
  const response = await queryWixDataItems<WixCalendarConnectionItem>('calendarConnections', { filter: { beaconCalendarConnectionId: id }, paging: { limit: 1 } });
  return mapWixCalendarConnectionItem(response.dataItems[0]?.data);
}

async function upsertConnection(connection: CalendarConnection, dataAdapterMode: DataAdapterMode): Promise<CalendarConnection> {
  const existing = await findConnectionById(connection.id, dataAdapterMode);

  if (dataAdapterMode === 'mock') {
    if (existing) {
      const index = calendarConnectionFixtures.findIndex((c) => c.id === connection.id);
      calendarConnectionFixtures[index] = connection;
    } else {
      calendarConnectionFixtures.push(connection);
    }
    return connection;
  }

  if (existing) {
    const response = await queryWixDataItems<WixCalendarConnectionItem>('calendarConnections', { filter: { beaconCalendarConnectionId: connection.id }, paging: { limit: 1 } });
    const existingItem = response.dataItems[0];
    if (!existingItem) throw new CalendarConnectionServiceError('Failed to locate calendar connection for update.');
    const merged = applyCalendarConnectionUpdateToWixData(existingItem.data, connection);
    await updateWixDataItem<WixCalendarConnectionItem>('calendarConnections', existingItem.id, merged);
    return connection;
  }

  await insertWixDataItem<WixCalendarConnectionItem>('calendarConnections', buildWixCalendarConnectionData(connection), connection.id);
  return connection;
}

async function patchConnection(
  organizationId: string,
  id: string,
  patch: Partial<
    Pick<
      CalendarConnection,
      'status' | 'externalCalendarId' | 'scopesGranted' | 'accessTokenCiphertext' | 'refreshTokenCiphertext' | 'tokenExpiresAt' | 'disconnectedAt' | 'lastSyncAt' | 'lastErrorAt' | 'lastErrorCode' | 'lastErrorMessage'
    >
  >,
  dataAdapterMode: DataAdapterMode,
): Promise<CalendarConnection> {
  const now = nowIso();
  if (dataAdapterMode === 'mock') {
    const index = calendarConnectionFixtures.findIndex((c) => c.id === id && c.organizationId === organizationId);
    if (index === -1) throw new CalendarConnectionServiceError('Calendar connection not found.');
    calendarConnectionFixtures[index] = { ...calendarConnectionFixtures[index], ...patch, updatedAt: now };
    return calendarConnectionFixtures[index];
  }
  const response = await queryWixDataItems<WixCalendarConnectionItem>('calendarConnections', { filter: { organizationId, beaconCalendarConnectionId: id }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new CalendarConnectionServiceError('Calendar connection not found.');
  const merged = applyCalendarConnectionUpdateToWixData(existingItem.data, { ...patch, updatedAt: now });
  const updated = await updateWixDataItem<WixCalendarConnectionItem>('calendarConnections', existingItem.id, merged);
  const mapped = mapWixCalendarConnectionItem(updated.data);
  if (!mapped) throw new CalendarConnectionServiceError('Failed to update calendar connection.');
  return mapped;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listConnectionsForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<CalendarConnection[]> {
  if (dataAdapterMode === 'mock') {
    return calendarConnectionFixtures.filter((c) => c.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixCalendarConnectionItem>('calendarConnections', { filter: { organizationId } });
  return response.dataItems.map((item) => mapWixCalendarConnectionItem(item.data)).filter((c): c is CalendarConnection => c !== null);
}

export async function listConnectionsForStaffProfile(organizationId: string, staffProfileId: string, dataAdapterMode: DataAdapterMode): Promise<CalendarConnection[]> {
  const all = await listConnectionsForOrganization(organizationId, dataAdapterMode);
  return all.filter((c) => c.staffProfileId === staffProfileId);
}

export async function getConnectionById(organizationId: string, connectionId: string, dataAdapterMode: DataAdapterMode): Promise<CalendarConnection | null> {
  const connection = await findConnectionById(connectionId, dataAdapterMode);
  return connection && connection.organizationId === organizationId ? connection : null;
}

/** The one active connection (if any) for a given (staffProfile,
    provider) pair — what `calendarSyncService.ts` resolves an
    appointment owner's sync target through. */
export async function getActiveConnectionForStaffProfile(
  organizationId: string,
  staffProfileId: string,
  provider: CalendarProviderName,
  dataAdapterMode: DataAdapterMode,
): Promise<CalendarConnection | null> {
  const connection = await findConnectionById(`${organizationId}-${staffProfileId}-${provider}`, dataAdapterMode);
  return connection && connection.status === 'connected' ? connection : null;
}

/** Every active connection for a StaffProfile, across both providers —
    used by `calendarSyncService.ts` to fan an appointment out to
    whichever calendars its owner has actually connected (a staff
    member could plausibly connect both Google and Microsoft). */
export async function listActiveConnectionsForStaffProfile(organizationId: string, staffProfileId: string, dataAdapterMode: DataAdapterMode): Promise<CalendarConnection[]> {
  const connections = await listConnectionsForStaffProfile(organizationId, staffProfileId, dataAdapterMode);
  return connections.filter((c) => c.status === 'connected');
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

export type BeginAuthorizationResult = { authorizeUrl: string; stateCookieValue: string };

/** Called from the "start" route — always same-origin,
    `requireSameOrigin`-checked by the caller before this runs. Mints a
    fresh `state`/PKCE pair, signs them (with the caller's own
    organizationId/staffProfileId/provider) into a short-lived cookie
    value the route sets, and returns the provider's own authorize URL
    to redirect to. */
export async function beginAuthorization(organizationId: string, staffProfileId: string, provider: CalendarProviderName, dataAdapterMode: DataAdapterMode): Promise<BeginAuthorizationResult> {
  // Re-verified here, not just by the route's own session check — the
  // caller must actually BE an active staff member of this
  // organization before any redirect to Google/Microsoft is built.
  await assertStaffProfileIsActiveAndInOrganization(organizationId, staffProfileId, dataAdapterMode);

  const state = generateOAuthState();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const stateCookieValue = signOAuthStateCookie({ state, codeVerifier, organizationId, staffProfileId, provider });
  const authorizeUrl = getProviderAdapter(provider).buildAuthorizeUrl(state, codeChallenge);

  return { authorizeUrl, stateCookieValue };
}

/** Called from the "callback" route — the one genuinely cross-origin
    leg of this flow (Google/Microsoft's own redirect), never
    `requireSameOrigin`-checked; `verifyOAuthStateCookie`'s signed,
    single-use, short-lived state is the substitute authenticity check,
    mirroring `app/api/webhooks/clover/route.ts`'s own precedent.
    organizationId/staffProfileId/provider are read back FROM the
    verified cookie, never accepted as separate request input — the
    same "read authoritative context off the resolved record, never
    trust client-supplied context" discipline
    `lib/auth/requireFamilyAccess.ts` already established. */
export async function completeAuthorization(
  provider: CalendarProviderName,
  code: string,
  stateCookieValue: string | undefined,
  returnedState: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CalendarConnection> {
  const verified = verifyOAuthStateCookie(stateCookieValue, returnedState);
  if (!verified || verified.provider !== provider) {
    throw new CalendarConnectionServiceError('Invalid or expired authorization request.');
  }
  const { organizationId, staffProfileId, codeVerifier } = verified;

  let staffProfile;
  try {
    staffProfile = await assertStaffProfileIsActiveAndInOrganization(organizationId, staffProfileId, dataAdapterMode);
  } catch (error) {
    throw error instanceof StaffAssignmentError ? new CalendarConnectionServiceError(error.message) : error;
  }

  const adapter = getProviderAdapter(provider);
  const tokens = await adapter.exchangeCodeForTokens(code, codeVerifier);

  // Defense in depth: one external account should never be silently
  // linked to two different staff members in the same organization.
  const orgConnections = await listConnectionsForOrganization(organizationId, dataAdapterMode);
  const collision = orgConnections.find((c) => c.provider === provider && c.externalAccountEmail === tokens.accountEmail && c.staffProfileId !== staffProfileId);
  if (collision) {
    throw new CalendarConnectionServiceError(`This ${provider === 'google' ? 'Google' : 'Microsoft'} account is already connected to a different staff member in this organization.`);
  }

  const calendars = await adapter.listCalendars(tokens.accessToken);
  const primaryCalendarId = calendars[0]?.id ?? 'primary';

  const now = nowIso();
  const existing = await findConnectionById(`${organizationId}-${staffProfileId}-${provider}`, dataAdapterMode);
  const connection: CalendarConnection = {
    id: `${organizationId}-${staffProfileId}-${provider}`,
    organizationId,
    staffProfileId,
    provider,
    externalAccountEmail: tokens.accountEmail,
    externalCalendarId: primaryCalendarId,
    status: 'connected',
    scopesGranted: provider === 'google' ? 'calendar.events calendar.readonly openid email' : 'Calendars.ReadWrite offline_access openid profile email',
    accessTokenCiphertext: encryptCalendarToken(tokens.accessToken),
    refreshTokenCiphertext: encryptCalendarToken(tokens.refreshToken),
    tokenExpiresAt: tokens.expiresAt,
    connectedAt: now,
    disconnectedAt: null,
    lastSyncAt: existing?.lastSyncAt ?? null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const persisted = await upsertConnection(connection, dataAdapterMode);

  // Best-effort, additive — mirrors every other record* call site's
  // try/catch convention (never fails the connection itself over a
  // logging gap). actorIdentityId is resolved from the connecting
  // StaffProfile's own identity — the OAuth callback route has no
  // ordinary session-derived actor to pass in (see this function's own
  // header comment on why the callback is exempt from requireSameOrigin).
  try {
    const ctx: ActivityContext = { organizationId, actorIdentityId: staffProfile.identityId, actorMembershipId: staffProfile.membershipId, actorRoleKey: null, correlationId: crypto.randomUUID() };
    await recordCalendarConnected(ctx, persisted.id, provider, persisted.externalAccountEmail, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.calendar.connected activity event:', error instanceof Error ? error.message : error);
  }

  return persisted;
}

/** Disconnecting clears the encrypted tokens outright (never left
    lingering once no longer needed) and marks the connection
    `disconnected` — the owning Appointment/CalendarEventLink data is
    completely untouched (invariant #2). No provider-side revocation
    call is made: Google/Microsoft's own "third-party app access"
    management is the normal, industry-standard place that grant is
    revoked from, not something Beacon needs to force — a deliberate,
    disclosed scope decision, not an oversight. `ctx` is built by the
    caller (the DELETE route) from its own resolved actor — the owning
    staff member disconnecting their own calendar, or an administrator
    acting via `calendar.manage` — never invented here. */
export async function disconnect(organizationId: string, connectionId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<CalendarConnection> {
  const updated = await patchConnection(
    organizationId,
    connectionId,
    { status: 'disconnected', disconnectedAt: nowIso(), accessTokenCiphertext: '', refreshTokenCiphertext: '' },
    dataAdapterMode,
  );

  try {
    await recordCalendarDisconnected(ctx, connectionId, updated.provider, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.calendar.disconnected activity event:', error instanceof Error ? error.message : error);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Token access — the only place a plaintext access token is ever exposed
// ---------------------------------------------------------------------------

const REFRESH_BUFFER_MS = 10 * 60 * 1000; // proactively refresh 10 minutes ahead of expiry

export type ValidAccessTokenResult = { accessToken: string; connection: CalendarConnection };

/** Decrypts the connection's access token, proactively refreshing it
    first if within `REFRESH_BUFFER_MS` of expiry (or already expired).
    On a successful refresh, persists the new ciphertext/expiry — the
    caller always receives a connection object reflecting whatever was
    actually persisted. On a refresh failure (e.g. the refresh token
    itself was revoked on the provider's side), flips the connection to
    `reauth_required` and rethrows — `calendarSyncService.ts` catches
    this and records it as a sync failure without ever touching the
    Appointment that triggered the sync. */
export async function getValidAccessToken(connection: CalendarConnection, dataAdapterMode: DataAdapterMode): Promise<ValidAccessTokenResult> {
  const expiresAtMs = new Date(connection.tokenExpiresAt).getTime();
  if (Date.now() < expiresAtMs - REFRESH_BUFFER_MS) {
    return { accessToken: decryptCalendarToken(connection.accessTokenCiphertext), connection };
  }

  try {
    const adapter = getProviderAdapter(connection.provider);
    const refreshToken = decryptCalendarToken(connection.refreshTokenCiphertext);
    const refreshed = await adapter.refreshAccessToken(refreshToken);
    const updated = await patchConnection(
      connection.organizationId,
      connection.id,
      { accessTokenCiphertext: encryptCalendarToken(refreshed.accessToken), refreshTokenCiphertext: encryptCalendarToken(refreshed.refreshToken), tokenExpiresAt: refreshed.expiresAt, status: 'connected' },
      dataAdapterMode,
    );
    return { accessToken: refreshed.accessToken, connection: updated };
  } catch (error) {
    await patchConnection(
      connection.organizationId,
      connection.id,
      { status: 'reauth_required', lastErrorAt: nowIso(), lastErrorCode: 'token_refresh_failed', lastErrorMessage: error instanceof Error ? error.message : String(error) },
      dataAdapterMode,
    );
    throw error;
  }
}

/** Thin re-export so callers (`calendarSyncService.ts`, routes) never
    need to look up a StaffProfile through a different module just to
    resolve who a connection belongs to. */
export { getStaffProfileById };
