import type { PortalUser, PortalUserStatus } from '../types/portalUser';

/**
 * Phase 29 (Family Portal & External Collaboration). The one place a raw
 * `portalUsers` Wix item is ever touched. Unlike `lib/wixIdentityMapper.ts`,
 * there's no separate public/secrets split here — `PortalUser.passwordHash`
 * lives inline on the type itself (see `types/portalUser.ts`'s own
 * comment); callers that must never leak it (every family-facing DTO
 * builder in `domain/portal/portal*View.ts`) are responsible for omitting
 * it, the same way every other family DTO omits internal fields.
 */
export type WixPortalUserItem = {
  beaconPortalUserId?: unknown;
  email?: unknown;
  normalizedEmail?: unknown;
  displayName?: unknown;
  passwordHash?: unknown;
  emailVerified?: unknown;
  status?: unknown;
  passwordResetTokenHash?: unknown;
  passwordResetExpiresAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_STATUSES: readonly PortalUserStatus[] = ['active', 'disabled'];

function isValidStatus(value: unknown): value is PortalUserStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

export function mapWixPortalUserItem(item: WixPortalUserItem | undefined): PortalUser | null {
  if (
    !item ||
    typeof item.beaconPortalUserId !== 'string' ||
    typeof item.email !== 'string' ||
    typeof item.normalizedEmail !== 'string' ||
    typeof item.displayName !== 'string' ||
    typeof item.passwordHash !== 'string' ||
    typeof item.emailVerified !== 'boolean' ||
    !isValidStatus(item.status) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconPortalUserId,
    email: item.email,
    normalizedEmail: item.normalizedEmail,
    displayName: item.displayName,
    passwordHash: item.passwordHash,
    emailVerified: item.emailVerified,
    status: item.status,
    passwordResetTokenHash: typeof item.passwordResetTokenHash === 'string' ? item.passwordResetTokenHash : null,
    passwordResetExpiresAt: typeof item.passwordResetExpiresAt === 'string' ? item.passwordResetExpiresAt : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixPortalUserData(user: PortalUser): WixPortalUserItem {
  return {
    beaconPortalUserId: user.id,
    email: user.email,
    normalizedEmail: user.normalizedEmail,
    displayName: user.displayName,
    passwordHash: user.passwordHash,
    emailVerified: user.emailVerified,
    status: user.status,
    passwordResetTokenHash: user.passwordResetTokenHash,
    passwordResetExpiresAt: user.passwordResetExpiresAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** Merges a partial patch onto the existing full Wix item — Wix Data's
    updateDataItem is a full replace, same reasoning as every other mapper
    in this codebase. */
export function applyPortalUserUpdateToWixData(existing: WixPortalUserItem, patch: Partial<PortalUser>): WixPortalUserItem {
  const next: WixPortalUserItem = { ...existing };
  if (patch.email !== undefined) next.email = patch.email;
  if (patch.normalizedEmail !== undefined) next.normalizedEmail = patch.normalizedEmail;
  if (patch.displayName !== undefined) next.displayName = patch.displayName;
  if (patch.passwordHash !== undefined) next.passwordHash = patch.passwordHash;
  if (patch.emailVerified !== undefined) next.emailVerified = patch.emailVerified;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.passwordResetTokenHash !== undefined) next.passwordResetTokenHash = patch.passwordResetTokenHash;
  if (patch.passwordResetExpiresAt !== undefined) next.passwordResetExpiresAt = patch.passwordResetExpiresAt;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
