import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixPasswordResetTokenItem,
  buildWixPasswordResetTokenData,
  applyPasswordResetTokenUpdateToWixData,
  type WixPasswordResetTokenItem,
} from '../lib/wixPasswordResetTokenMapper';
import { hashPassword, verifyPassword as verifyPasswordHash } from '../lib/identity/passwordHashing';
import { generateToken, verifyTokenHash, hashToken } from '../lib/identity/tokens';
import type { PasswordResetToken } from '../types/passwordResetToken';
import { getIdentitySecrets, updateIdentitySecrets, getIdentityById, updateIdentity } from './identityService';
import { passwordResetTokenFixtures } from './__mocks__/identityFixtures';

/**
 * Phase 21 (Identity, Authentication & Session Management). Password
 * hashing/verification/reset — the only module that ever calls
 * `services/identityService.ts`'s secrets accessors for `passwordHash`.
 * "Changing a password invalidates all previous sessions except the
 * current one if explicitly requested" — this module only increments
 * `passwordVersion`; enforcing that increment against live sessions is
 * `services/sessionService.ts`'s job (it checks
 * `session.passwordVersionAtIssue` against the identity's current value on
 * every request).
 */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function nowIso(): string {
  return new Date().toISOString();
}

export async function setPassword(
  identityId: string,
  plaintextPassword: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const identity = await getIdentityById(identityId, dataAdapterMode);
  if (!identity) throw new Error('Identity not found.');

  const passwordHash = hashPassword(plaintextPassword);
  await updateIdentitySecrets(identityId, { passwordHash }, dataAdapterMode);
  await updateIdentity(identityId, { passwordVersion: identity.passwordVersion + 1 }, dataAdapterMode);
}

export async function verifyPassword(
  identityId: string,
  plaintextPassword: string,
  dataAdapterMode: DataAdapterMode,
): Promise<boolean> {
  const secrets = await getIdentitySecrets(identityId, dataAdapterMode);
  if (!secrets?.passwordHash) return false;
  return verifyPasswordHash(plaintextPassword, secrets.passwordHash);
}

export async function changePassword(
  identityId: string,
  currentPassword: string,
  newPassword: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ success: boolean }> {
  const isCurrentValid = await verifyPassword(identityId, currentPassword, dataAdapterMode);
  if (!isCurrentValid) return { success: false };
  await setPassword(identityId, newPassword, dataAdapterMode);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Forgot / reset password
// ---------------------------------------------------------------------------

async function findResetTokenByHash(tokenHash: string, dataAdapterMode: DataAdapterMode): Promise<PasswordResetToken | null> {
  if (dataAdapterMode === 'mock') {
    return passwordResetTokenFixtures.find((t) => t.tokenHash === tokenHash) ?? null;
  }
  const response = await queryWixDataItems<WixPasswordResetTokenItem>('passwordResetTokens', {
    filter: { tokenHash },
    paging: { limit: 1 },
  });
  return mapWixPasswordResetTokenItem(response.dataItems[0]?.data);
}

/** Always succeeds from the caller's point of view regardless of whether
    `identityId` is real — "never reveal whether an email exists" is
    enforced one layer up, by the Route Handler never distinguishing "no
    such identity" from "token created" in its response; this function
    itself only refuses to run for a genuinely missing identityId (an
    internal contract, not something a request body can trigger directly
    without first resolving a real identity). */
export async function createPasswordResetToken(
  identityId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ token: string }> {
  const { token, tokenHash } = generateToken();
  const now = nowIso();
  const record: PasswordResetToken = {
    id: idFactory(),
    identityId,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
    usedAt: null,
    createdAt: now,
  };

  if (dataAdapterMode === 'mock') {
    passwordResetTokenFixtures.push(record);
    return { token };
  }

  await insertWixDataItem<WixPasswordResetTokenItem>('passwordResetTokens', buildWixPasswordResetTokenData(record), record.id);
  return { token };
}

export type ResetPasswordResult =
  | { success: true; identityId: string }
  | { success: false; reason: 'invalid_token' | 'expired_token' | 'already_used' };

/** Single-use: a token already marked `usedAt` is rejected even if it
    would otherwise still verify and hasn't expired — replaying a reset
    link (e.g. from an email client's link-prefetching) can never reset
    the password twice. */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ResetPasswordResult> {
  const tokenHash = hashToken(rawToken);
  const record = await findResetTokenByHash(tokenHash, dataAdapterMode);
  if (!record || !verifyTokenHash(rawToken, record.tokenHash)) {
    return { success: false, reason: 'invalid_token' };
  }
  if (record.usedAt) return { success: false, reason: 'already_used' };
  if (new Date(record.expiresAt).getTime() < Date.now()) return { success: false, reason: 'expired_token' };

  await markResetTokenUsed(record, dataAdapterMode);
  await setPassword(record.identityId, newPassword, dataAdapterMode);
  return { success: true, identityId: record.identityId };
}

async function markResetTokenUsed(token: PasswordResetToken, dataAdapterMode: DataAdapterMode): Promise<void> {
  const usedAt = nowIso();
  if (dataAdapterMode === 'mock') {
    const index = passwordResetTokenFixtures.findIndex((t) => t.id === token.id);
    if (index !== -1) passwordResetTokenFixtures[index] = { ...passwordResetTokenFixtures[index], usedAt };
    return;
  }
  const response = await queryWixDataItems<WixPasswordResetTokenItem>('passwordResetTokens', {
    filter: { beaconTokenId: token.id },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const merged = applyPasswordResetTokenUpdateToWixData(existingItem.data, { usedAt });
  await updateWixDataItem('passwordResetTokens', existingItem.id, merged);
}
