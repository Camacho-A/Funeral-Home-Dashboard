import type { PortalSession } from '../types/portalSession';

/**
 * Phase 29 (Family Portal & External Collaboration). The one place a raw
 * `portalSessions` Wix item is ever touched. Deliberately narrower than
 * `lib/wixIdentitySessionMapper.ts` — no `organizationId`, `rememberDevice`,
 * or `passwordVersionAtIssue` fields, mirroring `types/portalSession.ts`'s
 * own comment on why those don't apply here.
 */
export type WixPortalSessionItem = {
  beaconPortalSessionId?: unknown;
  portalUserId?: unknown;
  deviceId?: unknown;
  deviceName?: unknown;
  ipAddress?: unknown;
  userAgent?: unknown;
  expiresAt?: unknown;
  lastSeenAt?: unknown;
  revokedAt?: unknown;
  createdAt?: unknown;
};

export function mapWixPortalSessionItem(item: WixPortalSessionItem | undefined): PortalSession | null {
  if (
    !item ||
    typeof item.beaconPortalSessionId !== 'string' ||
    typeof item.portalUserId !== 'string' ||
    typeof item.deviceId !== 'string' ||
    typeof item.expiresAt !== 'string' ||
    typeof item.lastSeenAt !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconPortalSessionId,
    portalUserId: item.portalUserId,
    deviceId: item.deviceId,
    deviceName: typeof item.deviceName === 'string' ? item.deviceName : null,
    ipAddress: typeof item.ipAddress === 'string' ? item.ipAddress : null,
    userAgent: typeof item.userAgent === 'string' ? item.userAgent : null,
    expiresAt: item.expiresAt,
    lastSeenAt: item.lastSeenAt,
    revokedAt: typeof item.revokedAt === 'string' ? item.revokedAt : null,
    createdAt: item.createdAt,
  };
}

export function buildWixPortalSessionData(session: PortalSession): WixPortalSessionItem {
  return {
    beaconPortalSessionId: session.id,
    portalUserId: session.portalUserId,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    revokedAt: session.revokedAt,
    createdAt: session.createdAt,
  };
}

/** Merges a partial patch onto the existing full Wix item — the only
    fields ever updated after creation are `expiresAt`/`lastSeenAt`
    (sliding expiration) and `revokedAt`, mirroring
    `applyIdentitySessionUpdateToWixData`'s own narrower-than-full-type
    patch surface. */
export function applyPortalSessionUpdateToWixData(
  existing: WixPortalSessionItem,
  patch: Partial<PortalSession>,
): WixPortalSessionItem {
  const next: WixPortalSessionItem = { ...existing };
  if (patch.expiresAt !== undefined) next.expiresAt = patch.expiresAt;
  if (patch.lastSeenAt !== undefined) next.lastSeenAt = patch.lastSeenAt;
  if (patch.revokedAt !== undefined) next.revokedAt = patch.revokedAt;
  return next;
}
