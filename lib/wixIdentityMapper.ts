import type { Identity, IdentitySecrets, IdentityStatus } from '../types/identity';

/**
 * Phase 21 (Identity, Authentication & Session Management). The one place
 * a raw `identities` Wix item is ever touched. Deliberately splits mapping
 * into two functions: `mapWixIdentityItem` (the public `Identity` shape,
 * safe to return from any API route) and `mapWixIdentitySecrets` (password
 * hash / MFA material, read only by `services/passwordService.ts`/
 * `services/mfaService.ts`) — even though both live on the same Wix row,
 * no caller of the public mapper can accidentally receive a secret field.
 */
export type WixIdentityItem = {
  beaconIdentityId?: unknown;
  email?: unknown;
  normalizedEmail?: unknown;
  displayName?: unknown;
  /** Phase 33 (Real Notification Delivery) addition. */
  phone?: unknown;
  status?: unknown;
  emailVerified?: unknown;
  passwordVersion?: unknown;
  mfaEnabled?: unknown;
  lastLoginAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  passwordHash?: unknown;
  mfaSecretReference?: unknown;
  mfaVerifiedAt?: unknown;
  mfaRecoveryCodeHashes?: unknown;
};

const VALID_STATUSES: IdentityStatus[] = ['pending', 'active', 'locked', 'disabled', 'deleted'];

function isValidStatus(value: unknown): value is IdentityStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}

export function mapWixIdentityItem(item: WixIdentityItem | undefined): Identity | null {
  if (
    !item ||
    typeof item.beaconIdentityId !== 'string' ||
    typeof item.email !== 'string' ||
    typeof item.normalizedEmail !== 'string' ||
    typeof item.displayName !== 'string' ||
    !isValidStatus(item.status) ||
    typeof item.emailVerified !== 'boolean' ||
    typeof item.passwordVersion !== 'number' ||
    typeof item.mfaEnabled !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconIdentityId,
    email: item.email,
    normalizedEmail: item.normalizedEmail,
    displayName: item.displayName,
    phone: typeof item.phone === 'string' ? item.phone : null,
    status: item.status,
    emailVerified: item.emailVerified,
    passwordVersion: item.passwordVersion,
    mfaEnabled: item.mfaEnabled,
    lastLoginAt: typeof item.lastLoginAt === 'string' ? item.lastLoginAt : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function mapWixIdentitySecrets(item: WixIdentityItem | undefined): IdentitySecrets | null {
  if (!item) return null;
  return {
    passwordHash: typeof item.passwordHash === 'string' ? item.passwordHash : null,
    mfaSecretReference: typeof item.mfaSecretReference === 'string' ? item.mfaSecretReference : null,
    mfaVerifiedAt: typeof item.mfaVerifiedAt === 'string' ? item.mfaVerifiedAt : null,
    mfaRecoveryCodeHashes: isStringArray(item.mfaRecoveryCodeHashes) ? item.mfaRecoveryCodeHashes : [],
  };
}

export function buildWixIdentityData(identity: Identity, secrets: IdentitySecrets): WixIdentityItem {
  return {
    beaconIdentityId: identity.id,
    email: identity.email,
    normalizedEmail: identity.normalizedEmail,
    displayName: identity.displayName,
    phone: identity.phone,
    status: identity.status,
    emailVerified: identity.emailVerified,
    passwordVersion: identity.passwordVersion,
    mfaEnabled: identity.mfaEnabled,
    lastLoginAt: identity.lastLoginAt,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    passwordHash: secrets.passwordHash,
    mfaSecretReference: secrets.mfaSecretReference,
    mfaVerifiedAt: secrets.mfaVerifiedAt,
    mfaRecoveryCodeHashes: secrets.mfaRecoveryCodeHashes,
  };
}

/** Merges a partial patch onto the existing full Wix item — Wix Data's
    updateDataItem is a full replace, same reasoning as every other mapper
    in this codebase. Accepts a patch against either the public `Identity`
    shape or the internal `IdentitySecrets` shape (or both at once). */
export function applyIdentityUpdateToWixData(
  existing: WixIdentityItem,
  patch: Partial<Identity> & Partial<IdentitySecrets>,
): WixIdentityItem {
  const next: WixIdentityItem = { ...existing };
  if (patch.email !== undefined) next.email = patch.email;
  if (patch.normalizedEmail !== undefined) next.normalizedEmail = patch.normalizedEmail;
  if (patch.displayName !== undefined) next.displayName = patch.displayName;
  if (patch.phone !== undefined) next.phone = patch.phone;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.emailVerified !== undefined) next.emailVerified = patch.emailVerified;
  if (patch.passwordVersion !== undefined) next.passwordVersion = patch.passwordVersion;
  if (patch.mfaEnabled !== undefined) next.mfaEnabled = patch.mfaEnabled;
  if (patch.lastLoginAt !== undefined) next.lastLoginAt = patch.lastLoginAt;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  if (patch.passwordHash !== undefined) next.passwordHash = patch.passwordHash;
  if (patch.mfaSecretReference !== undefined) next.mfaSecretReference = patch.mfaSecretReference;
  if (patch.mfaVerifiedAt !== undefined) next.mfaVerifiedAt = patch.mfaVerifiedAt;
  if (patch.mfaRecoveryCodeHashes !== undefined) next.mfaRecoveryCodeHashes = patch.mfaRecoveryCodeHashes;
  return next;
}
