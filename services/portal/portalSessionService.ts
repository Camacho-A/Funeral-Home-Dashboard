import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../../lib/wixDataApi';
import {
  mapWixPortalSessionItem,
  buildWixPortalSessionData,
  applyPortalSessionUpdateToWixData,
  type WixPortalSessionItem,
} from '../../lib/wixPortalSessionMapper';
import type { PortalSession } from '../../types/portalSession';
import { portalSessionFixtures } from '../__mocks__/portalFixtures';

/**
 * Phase 29 (Family Portal & External Collaboration). The server-side
 * revocable registry for family sessions — the `IdentitySession`-service
 * sibling for `PortalSession`. A single sliding-window TTL (unlike
 * `sessionService.ts`'s 1h/30d "remember device" split) — see
 * `types/portalSession.ts`'s own comment on why no such tier exists here.
 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days sliding window

function nowIso(): string {
  return new Date().toISOString();
}

export async function createPortalSession(
  params: {
    portalUserId: string;
    deviceId: string;
    deviceName?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<PortalSession> {
  const now = nowIso();
  const session: PortalSession = {
    id: params.idFactory(),
    portalUserId: params.portalUserId,
    deviceId: params.deviceId,
    deviceName: params.deviceName ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    lastSeenAt: now,
    revokedAt: null,
    createdAt: now,
  };

  if (dataAdapterMode === 'mock') {
    portalSessionFixtures.push(session);
    return session;
  }

  const inserted = await insertWixDataItem<WixPortalSessionItem>('portalSessions', buildWixPortalSessionData(session), session.id);
  const mapped = mapWixPortalSessionItem(inserted.data);
  if (!mapped) throw new Error('Failed to create portal session.');
  return mapped;
}

export async function getSessionById(sessionId: string, dataAdapterMode: DataAdapterMode): Promise<PortalSession | null> {
  if (dataAdapterMode === 'mock') {
    return portalSessionFixtures.find((s) => s.id === sessionId) ?? null;
  }
  const response = await queryWixDataItems<WixPortalSessionItem>('portalSessions', {
    filter: { beaconPortalSessionId: sessionId },
    paging: { limit: 1 },
  });
  return mapWixPortalSessionItem(response.dataItems[0]?.data);
}

export async function listActiveSessionsForPortalUser(portalUserId: string, dataAdapterMode: DataAdapterMode): Promise<PortalSession[]> {
  const now = Date.now();
  const all =
    dataAdapterMode === 'mock'
      ? portalSessionFixtures.filter((s) => s.portalUserId === portalUserId)
      : await (async () => {
          const response = await queryWixDataItems<WixPortalSessionItem>('portalSessions', { filter: { portalUserId } });
          return response.dataItems.map((item) => mapWixPortalSessionItem(item.data)).filter((s): s is PortalSession => s !== null);
        })();

  return all
    .filter((s) => s.revokedAt === null && new Date(s.expiresAt).getTime() > now)
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

async function persistSessionUpdate(
  sessionId: string,
  patch: Partial<PortalSession>,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalSession | null> {
  if (dataAdapterMode === 'mock') {
    const index = portalSessionFixtures.findIndex((s) => s.id === sessionId);
    if (index === -1) return null;
    portalSessionFixtures[index] = { ...portalSessionFixtures[index], ...patch };
    return portalSessionFixtures[index];
  }
  const response = await queryWixDataItems<WixPortalSessionItem>('portalSessions', {
    filter: { beaconPortalSessionId: sessionId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyPortalSessionUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixPortalSessionItem>('portalSessions', existingItem.id, merged);
  return mapWixPortalSessionItem(updated.data);
}

/** Sliding expiration — extends `expiresAt` from now, bumps `lastSeenAt`.
    Called on every successfully-validated family request (see
    `lib/auth/resolveFamilySession.ts`), never on a rejected one. */
export async function touchSession(sessionId: string, dataAdapterMode: DataAdapterMode): Promise<PortalSession | null> {
  const now = nowIso();
  return persistSessionUpdate(sessionId, { lastSeenAt: now, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }, dataAdapterMode);
}

export async function revokeSession(sessionId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  await persistSessionUpdate(sessionId, { revokedAt: nowIso() }, dataAdapterMode);
}

/** "Sign Out Everywhere" for a portal user (e.g. after a password reset,
    or staff revoking access) — returns how many sessions were revoked. */
export async function revokeAllSessionsForPortalUser(
  portalUserId: string,
  dataAdapterMode: DataAdapterMode,
  exceptSessionId?: string,
): Promise<number> {
  const active = await listActiveSessionsForPortalUser(portalUserId, dataAdapterMode);
  const toRevoke = active.filter((s) => s.id !== exceptSessionId);
  await Promise.all(toRevoke.map((s) => revokeSession(s.id, dataAdapterMode)));
  return toRevoke.length;
}
