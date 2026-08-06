import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, WixDataApiError } from '../../lib/wixDataApi';
import {
  mapWixPortalUserItem,
  buildWixPortalUserData,
  applyPortalUserUpdateToWixData,
  type WixPortalUserItem,
} from '../../lib/wixPortalUserMapper';
import type { PortalUser } from '../../types/portalUser';
import { normalizeEmail } from '../../domain/identity/email';
import { portalUserFixtures } from '../__mocks__/portalFixtures';

/**
 * Phase 29 (Family Portal & External Collaboration). Owns the
 * `portalUsers` Wix collection exclusively — the identity-service sibling
 * for the physically separate family-side population (see
 * `types/portalUser.ts`'s own comment on why this is never
 * `services/identityService.ts` or the `identities` collection).
 *
 * Reuses `lib/identity/passwordHashing.ts`'s pure `hashPassword`/
 * `verifyPassword` functions as needed by callers (`portalInvitationService.ts`'s
 * acceptance flow, a future `/api/family/login` route) — this module never
 * calls them itself, exactly mirroring how `identityService.ts` never
 * calls `passwordHashing.ts` directly either, leaving that to
 * `passwordService.ts`. Here there's no separate `portalPasswordService.ts`
 * (the surface is small enough that the caller hashes and passes the
 * resulting string straight through).
 */

const WIX_CONFLICT_STATUS = 409;
function isWixConflict(error: unknown): boolean {
  return error instanceof WixDataApiError && error.status === WIX_CONFLICT_STATUS;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function getPortalUserById(portalUserId: string, dataAdapterMode: DataAdapterMode): Promise<PortalUser | null> {
  if (dataAdapterMode === 'mock') {
    return portalUserFixtures.find((u) => u.id === portalUserId) ?? null;
  }
  const response = await queryWixDataItems<WixPortalUserItem>('portalUsers', {
    filter: { beaconPortalUserId: portalUserId },
    paging: { limit: 1 },
  });
  return mapWixPortalUserItem(response.dataItems[0]?.data);
}

export async function findPortalUserByEmail(email: string, dataAdapterMode: DataAdapterMode): Promise<PortalUser | null> {
  const normalizedEmail = normalizeEmail(email);
  if (dataAdapterMode === 'mock') {
    return portalUserFixtures.find((u) => u.normalizedEmail === normalizedEmail) ?? null;
  }
  const response = await queryWixDataItems<WixPortalUserItem>('portalUsers', {
    filter: { normalizedEmail },
    paging: { limit: 1 },
  });
  return mapWixPortalUserItem(response.dataItems[0]?.data);
}

/**
 * Idempotent by `normalizedEmail` — mirrors `identityService.ts`'s own
 * `findOrCreateIdentity` precedent: a person invited to the Family Portal
 * for a second case (or a second time for the same case) must resolve to
 * the *same* `PortalUser` row, never a duplicate. Only ever called from
 * `portalInvitationService.ts`'s acceptance flow — there is no
 * self-registration route (refinement #15).
 *
 * When an existing user is found, `passwordHash` is **not** overwritten —
 * accepting a second invitation never resets an already-chosen password.
 * The caller is responsible for only prompting for a new password when
 * `isNew` is true.
 */
export async function findOrCreatePortalUser(
  params: { email: string; displayName: string; passwordHash: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ portalUser: PortalUser; isNew: boolean }> {
  const existing = await findPortalUserByEmail(params.email, dataAdapterMode);
  if (existing) return { portalUser: existing, isNew: false };

  const now = nowIso();
  const portalUser: PortalUser = {
    id: params.idFactory(),
    email: params.email,
    normalizedEmail: normalizeEmail(params.email),
    displayName: params.displayName,
    passwordHash: params.passwordHash,
    emailVerified: false,
    status: 'active',
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    portalUserFixtures.push(portalUser);
    return { portalUser, isNew: true };
  }

  try {
    const inserted = await insertWixDataItem<WixPortalUserItem>('portalUsers', buildWixPortalUserData(portalUser), portalUser.id);
    const mapped = mapWixPortalUserItem(inserted.data);
    if (!mapped) throw new Error('Failed to create portal user.');
    return { portalUser: mapped, isNew: true };
  } catch (error) {
    if (!isWixConflict(error)) throw error;
    const reFetched = await findPortalUserByEmail(params.email, dataAdapterMode);
    if (!reFetched) throw error;
    return { portalUser: reFetched, isNew: false };
  }
}

export async function findPortalUserByPasswordResetTokenHash(tokenHash: string, dataAdapterMode: DataAdapterMode): Promise<PortalUser | null> {
  if (dataAdapterMode === 'mock') {
    return portalUserFixtures.find((u) => u.passwordResetTokenHash === tokenHash) ?? null;
  }
  const response = await queryWixDataItems<WixPortalUserItem>('portalUsers', {
    filter: { passwordResetTokenHash: tokenHash },
    paging: { limit: 1 },
  });
  return mapWixPortalUserItem(response.dataItems[0]?.data);
}

export async function updatePortalUser(
  portalUserId: string,
  patch: Partial<PortalUser>,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalUser | null> {
  const nextPatch = { ...patch, updatedAt: nowIso() };

  if (dataAdapterMode === 'mock') {
    const index = portalUserFixtures.findIndex((u) => u.id === portalUserId);
    if (index === -1) return null;
    portalUserFixtures[index] = { ...portalUserFixtures[index], ...nextPatch };
    return portalUserFixtures[index];
  }

  const response = await queryWixDataItems<WixPortalUserItem>('portalUsers', {
    filter: { beaconPortalUserId: portalUserId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyPortalUserUpdateToWixData(existingItem.data, nextPatch);
  const updated = await updateWixDataItem<WixPortalUserItem>('portalUsers', existingItem.id, merged);
  return mapWixPortalUserItem(updated.data);
}

/** Issues a password-reset token for the portal user with this email, if
    one exists — the caller (the `/api/family/forgot-password` route) is
    responsible for the "never reveal whether an email exists" discipline:
    it always returns the same generic success response whether or not
    this function actually found a user, and only sends an email when it
    did. Mirrors `passwordService.ts`'s own `requestPasswordReset`
    precedent, reusing `lib/identity/tokens.ts`'s `generateToken`/`hashToken` —
    the raw token is returned here for the route to email; never persisted. */
export async function requestPortalPasswordReset(
  params: { email: string; tokenHash: string; expiresAt: string },
  dataAdapterMode: DataAdapterMode,
): Promise<PortalUser | null> {
  const user = await findPortalUserByEmail(params.email, dataAdapterMode);
  if (!user) return null;
  return updatePortalUser(user.id, { passwordResetTokenHash: params.tokenHash, passwordResetExpiresAt: params.expiresAt }, dataAdapterMode);
}

/** Consumes a password-reset token — resolves the user by the token's
    hash, verifies it hasn't expired, sets the new password hash, and
    clears the token fields so it can never be replayed (no separate
    "used" flag needed, mirroring `PortalInvitation`'s own single-use
    status-machine convention). Returns `null` for any invalid, expired,
    or unknown token — the caller never distinguishes which. */
export async function resetPortalPasswordWithToken(
  tokenHash: string,
  newPasswordHash: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalUser | null> {
  const user = await findPortalUserByPasswordResetTokenHash(tokenHash, dataAdapterMode);
  if (!user || !user.passwordResetTokenHash || !user.passwordResetExpiresAt) return null;
  if (new Date(user.passwordResetExpiresAt).getTime() < Date.now()) return null;

  return updatePortalUser(user.id, { passwordHash: newPasswordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null }, dataAdapterMode);
}
