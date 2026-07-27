import type { IdentitySession } from '../types/identitySession';

export type WixIdentitySessionItem = {
  beaconSessionId?: unknown;
  identityId?: unknown;
  organizationId?: unknown;
  deviceId?: unknown;
  deviceName?: unknown;
  ipAddress?: unknown;
  userAgent?: unknown;
  expiresAt?: unknown;
  lastSeenAt?: unknown;
  rememberDevice?: unknown;
  passwordVersionAtIssue?: unknown;
  revokedAt?: unknown;
  createdAt?: unknown;
};

export function mapWixIdentitySessionItem(item: WixIdentitySessionItem | undefined): IdentitySession | null {
  if (
    !item ||
    typeof item.beaconSessionId !== 'string' ||
    typeof item.identityId !== 'string' ||
    typeof item.deviceId !== 'string' ||
    typeof item.expiresAt !== 'string' ||
    typeof item.lastSeenAt !== 'string' ||
    typeof item.rememberDevice !== 'boolean' ||
    typeof item.passwordVersionAtIssue !== 'number' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconSessionId,
    identityId: item.identityId,
    organizationId: typeof item.organizationId === 'string' ? item.organizationId : null,
    deviceId: item.deviceId,
    deviceName: typeof item.deviceName === 'string' ? item.deviceName : null,
    ipAddress: typeof item.ipAddress === 'string' ? item.ipAddress : null,
    userAgent: typeof item.userAgent === 'string' ? item.userAgent : null,
    expiresAt: item.expiresAt,
    lastSeenAt: item.lastSeenAt,
    rememberDevice: item.rememberDevice,
    passwordVersionAtIssue: item.passwordVersionAtIssue,
    revokedAt: typeof item.revokedAt === 'string' ? item.revokedAt : null,
    createdAt: item.createdAt,
  };
}

export function buildWixIdentitySessionData(session: IdentitySession): WixIdentitySessionItem {
  return {
    beaconSessionId: session.id,
    identityId: session.identityId,
    organizationId: session.organizationId,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    rememberDevice: session.rememberDevice,
    passwordVersionAtIssue: session.passwordVersionAtIssue,
    revokedAt: session.revokedAt,
    createdAt: session.createdAt,
  };
}

/** Merges a partial patch onto the existing full Wix item — the only
    fields ever updated after creation are `organizationId` (switching),
    `expiresAt`/`lastSeenAt` (sliding expiration), and `revokedAt`. */
export function applyIdentitySessionUpdateToWixData(
  existing: WixIdentitySessionItem,
  patch: Partial<IdentitySession>,
): WixIdentitySessionItem {
  const next: WixIdentitySessionItem = { ...existing };
  if (patch.organizationId !== undefined) next.organizationId = patch.organizationId;
  if (patch.expiresAt !== undefined) next.expiresAt = patch.expiresAt;
  if (patch.lastSeenAt !== undefined) next.lastSeenAt = patch.lastSeenAt;
  if (patch.revokedAt !== undefined) next.revokedAt = patch.revokedAt;
  return next;
}
