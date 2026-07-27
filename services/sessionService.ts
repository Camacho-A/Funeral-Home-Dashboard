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
 */
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour sliding window
const REMEMBERED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function nowIso(): string {
  return new Date().toISOString();
}

export async function createIdentitySession(
  params: {
    identityId: string;
    deviceId: string;
    deviceName?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    rememberDevice: boolean;
    passwordVersionAtIssue: number;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<IdentitySession> {
  const now = nowIso();
  const ttl = params.rememberDevice ? REMEMBERED_DEVICE_TTL_MS : SESSION_TTL_MS;
  const session: IdentitySession = {
    id: params.idFactory(),
    identityId: params.identityId,
    organizationId: null,
    deviceId: params.deviceId,
    deviceName: params.deviceName ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
    lastSeenAt: now,
    rememberDevice: params.rememberDevice,
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

/** Sliding expiration — extends `expiresAt` from now, bumps `lastSeenAt`.
    Called on every successfully-validated identity-mode request (see
    lib/auth/resolveIdentitySession.ts), never on a rejected one. */
export async function touchSession(sessionId: string, dataAdapterMode: DataAdapterMode): Promise<IdentitySession | null> {
  const session = await getSessionById(sessionId, dataAdapterMode);
  if (!session) return null;
  const ttl = session.rememberDevice ? REMEMBERED_DEVICE_TTL_MS : SESSION_TTL_MS;
  const now = nowIso();
  return persistSessionUpdate(sessionId, { lastSeenAt: now, expiresAt: new Date(Date.now() + ttl).toISOString() }, dataAdapterMode);
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
