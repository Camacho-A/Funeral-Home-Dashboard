import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixIdentitySessionItem,
  buildWixIdentitySessionData,
  applyIdentitySessionUpdateToWixData,
  type WixIdentitySessionItem,
} from '../lib/wixIdentitySessionMapper';
import type { IdentitySession } from '../types/identitySession';
import { identitySessionFixtures } from './__mocks__/identityFixtures';

/**
 * Phase 21 (Identity, Authentication & Session Management). The
 * server-side session *registry* — see `types/identitySession.ts`'s own
 * comment on why this exists alongside the stateless signed cookie.
 * Every `AUTH_ADAPTER='identity'` request re-validates against a row here
 * (see `lib/auth/resolveIdentitySession.ts`); `'mock'`/`'wix'` sessions
 * never create or read one.
 *
 * Staff session policy (2026-09 correction): an employee actively using
 * Solis through a normal shift — including gaps for calls, lunch, pickups,
 * tabbing away to email — must not be unexpectedly logged out, while a
 * genuinely abandoned session must still expire, and no session may live
 * forever purely on periodic activity. Two independent limits, always
 * combined as `min(lastSeenAt + SESSION_IDLE_TTL_MS, createdAt +
 * SESSION_ABSOLUTE_MAX_MS)`:
 * - `SESSION_IDLE_TTL_MS` (4h): the sliding window — extended by
 *   `touchSession` on activity, so it never fires mid-shift for someone
 *   still working, only after a real, multi-hour gap.
 * - `SESSION_ABSOLUTE_MAX_MS` (16h): a hard ceiling measured from
 *   `createdAt` (the one persisted timestamp `touchSession` never
 *   modifies) — no amount of activity can push a session past this, so
 *   staff re-authenticate at least once a day by construction.
 * `SESSION_TOUCH_THROTTLE_MS` (5min) is a pure write-cost optimization: a
 * request that arrives within the throttle window of the last recorded
 * `lastSeenAt` is still granted (its existing, not-yet-expired
 * `expiresAt` already covers it) without writing the row again — see
 * `touchSession`'s own comment.
 *
 * "Remember this device" (a 30-day-session opt-in) has been removed from
 * the staff login flow entirely — it would have let a session outlive the
 * new absolute maximum, which is exactly the thing this policy exists to
 * prevent. `IdentitySession` rows created before this change may still
 * carry a now-unused `rememberDevice` field in Wix; it's simply never
 * read or written again, and is harmless left as-is (no production
 * migration performed or required).
 */
const SESSION_IDLE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours, sliding
const SESSION_ABSOLUTE_MAX_MS = 16 * 60 * 60 * 1000; // 16 hours from createdAt, hard ceiling
const SESSION_TOUCH_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes — skip redundant writes, not redundant validation

function nowIso(): string {
  return new Date().toISOString();
}

/** `min(createdAt-relative absolute ceiling, from-now idle window)` — the
    one place both limits are combined, used identically at creation and
    on every touch, so "how long can this session possibly stay valid
    from here" is never computed two different ways. */
function computeExpiresAt(createdAt: string, now: number): string {
  const idleDeadline = now + SESSION_IDLE_TTL_MS;
  const absoluteDeadline = new Date(createdAt).getTime() + SESSION_ABSOLUTE_MAX_MS;
  return new Date(Math.min(idleDeadline, absoluteDeadline)).toISOString();
}

export async function createIdentitySession(
  params: {
    identityId: string;
    deviceId: string;
    deviceName?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    passwordVersionAtIssue: number;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<IdentitySession> {
  const now = nowIso();
  const session: IdentitySession = {
    id: params.idFactory(),
    identityId: params.identityId,
    organizationId: null,
    deviceId: params.deviceId,
    deviceName: params.deviceName ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    expiresAt: computeExpiresAt(now, Date.now()),
    lastSeenAt: now,
    passwordVersionAtIssue: params.passwordVersionAtIssue,
    revokedAt: null,
    createdAt: now,
  };

  if (dataAdapterMode === 'mock') {
    identitySessionFixtures.push(session);
    return session;
  }

  const inserted = await insertWixDataItem<WixIdentitySessionItem>('sessions', buildWixIdentitySessionData(session), session.id);
  const mapped = mapWixIdentitySessionItem(inserted.data);
  if (!mapped) throw new Error('Failed to create session.');
  return mapped;
}

export async function getSessionById(sessionId: string, dataAdapterMode: DataAdapterMode): Promise<IdentitySession | null> {
  if (dataAdapterMode === 'mock') {
    return identitySessionFixtures.find((s) => s.id === sessionId) ?? null;
  }
  const response = await queryWixDataItems<WixIdentitySessionItem>('sessions', {
    filter: { beaconSessionId: sessionId },
    paging: { limit: 1 },
  });
  return mapWixIdentitySessionItem(response.dataItems[0]?.data);
}

export async function listActiveSessionsForIdentity(identityId: string, dataAdapterMode: DataAdapterMode): Promise<IdentitySession[]> {
  const now = Date.now();
  const all =
    dataAdapterMode === 'mock'
      ? identitySessionFixtures.filter((s) => s.identityId === identityId)
      : await (async () => {
          const response = await queryWixDataItems<WixIdentitySessionItem>('sessions', { filter: { identityId } });
          return response.dataItems.map((item) => mapWixIdentitySessionItem(item.data)).filter((s): s is IdentitySession => s !== null);
        })();

  return all
    .filter((s) => s.revokedAt === null && new Date(s.expiresAt).getTime() > now)
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

async function persistSessionUpdate(
  sessionId: string,
  patch: Partial<IdentitySession>,
  dataAdapterMode: DataAdapterMode,
): Promise<IdentitySession | null> {
  if (dataAdapterMode === 'mock') {
    const index = identitySessionFixtures.findIndex((s) => s.id === sessionId);
    if (index === -1) return null;
    identitySessionFixtures[index] = { ...identitySessionFixtures[index], ...patch };
    return identitySessionFixtures[index];
  }
  const response = await queryWixDataItems<WixIdentitySessionItem>('sessions', {
    filter: { beaconSessionId: sessionId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyIdentitySessionUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixIdentitySessionItem>('sessions', existingItem.id, merged);
  return mapWixIdentitySessionItem(updated.data);
}

/**
 * Sliding expiration — extends `expiresAt` forward from now, capped at
 * `createdAt` + the absolute session maximum, and bumps `lastSeenAt`.
 * Called on every successfully-validated identity-mode request (see
 * `lib/auth/resolveIdentitySession.ts`), never on a rejected one.
 *
 * Touch-throttled: if the session was already touched within the last
 * `SESSION_TOUCH_THROTTLE_MS`, this is a no-op read (no write) — the
 * request is still being *granted* on the strength of the row's existing,
 * not-yet-expired `expiresAt` (checked by the caller before this runs);
 * skipping the write here only avoids a redundant persistence op on rapid
 * successive requests, it never rejects or shortens anything. Returns the
 * unmodified session in that case, exactly as if a write had occurred with
 * no effective change.
 *
 * `createdAt` is never touched — it's the one fixed point
 * `computeExpiresAt` measures the absolute ceiling from, so no amount of
 * activity (or repeated calls to this function) can ever move the
 * absolute deadline later.
 */
export async function touchSession(sessionId: string, dataAdapterMode: DataAdapterMode): Promise<IdentitySession | null> {
  const session = await getSessionById(sessionId, dataAdapterMode);
  if (!session) return null;

  const now = Date.now();
  if (now - new Date(session.lastSeenAt).getTime() < SESSION_TOUCH_THROTTLE_MS) {
    return session;
  }

  const nowIsoValue = nowIso();
  return persistSessionUpdate(
    sessionId,
    { lastSeenAt: nowIsoValue, expiresAt: computeExpiresAt(session.createdAt, now) },
    dataAdapterMode,
  );
}

/** Never trusts a client-supplied organizationId as proof of membership —
    the caller (the `/switch-organization` route) must independently
    confirm an active `Membership` exists before calling this. */
export async function setSessionOrganization(
  sessionId: string,
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<IdentitySession | null> {
  return persistSessionUpdate(sessionId, { organizationId }, dataAdapterMode);
}

export async function revokeSession(sessionId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  await persistSessionUpdate(sessionId, { revokedAt: nowIso() }, dataAdapterMode);
}

/** Updates a *kept-alive* session's own `passwordVersionAtIssue` to match
    the identity's new password version. Only ever needed by
    services/passwordService.ts-adjacent flows (change-password's
    `keepCurrentSession` option): without this, a session deliberately
    exempted from revocation during a password change would still be
    rejected on its very next use by lib/auth/resolveIdentitySession.ts's
    own version check — the two mechanisms would otherwise silently fight
    each other. */
export async function refreshSessionPasswordVersion(
  sessionId: string,
  passwordVersionAtIssue: number,
  dataAdapterMode: DataAdapterMode,
): Promise<IdentitySession | null> {
  return persistSessionUpdate(sessionId, { passwordVersionAtIssue }, dataAdapterMode);
}

/** "Sign Out Other Devices" (pass the current session id to exclude) or
    "Sign Out Everywhere" (omit it) — returns how many sessions were
    revoked. */
export async function revokeAllSessionsForIdentity(
  identityId: string,
  dataAdapterMode: DataAdapterMode,
  exceptSessionId?: string,
): Promise<number> {
  const active = await listActiveSessionsForIdentity(identityId, dataAdapterMode);
  const toRevoke = active.filter((s) => s.id !== exceptSessionId);
  await Promise.all(toRevoke.map((s) => revokeSession(s.id, dataAdapterMode)));
  return toRevoke.length;
}
