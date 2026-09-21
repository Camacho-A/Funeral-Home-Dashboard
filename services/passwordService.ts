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
import type { Identity } from '../types/identity';
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

/**
 * Security correction (2026-09, Manors go-live). The single source of truth
 * for "is this identity allowed to receive/redeem a password reset" —
 * `active` only, matching `app/login/actions.ts`'s own pre-existing policy
 * for who may authenticate at all (`pending` → "complete email
 * verification first"; `locked` → "account locked"; anything else is
 * rejected too). Previously each call site checked
 * `status !== 'disabled' && status !== 'deleted'`, an exclude-list that
 * silently left `pending` (never-activated, no password set yet — a
 * forgot-password reset makes no sense for an account with nothing to
 * reset) and `locked` (an active brute-force lockout) able to receive and
 * redeem a fully working reset link, undermining the lockout entirely and
 * letting a reset activate an invited-but-never-onboarded identity outside
 * its real invitation/setup flow. Exported so both the API route and the
 * Server Action (and this file's own consumption-time re-check) share one
 * definition — never re-implemented at each call site again.
 */
export function isIdentityEligibleForPasswordReset(identity: Identity | null): identity is Identity {
  return identity !== null && identity.status === 'active';
}

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
  | { success: false; reason: 'invalid_token' | 'expired_token' | 'already_used' | 'identity_not_eligible' };

/** Single-use: a token already marked `usedAt` is rejected even if it
    would otherwise still verify and hasn't expired — replaying a reset
    link (e.g. from an email client's link-prefetching) can never reset
    the password twice.
    Security correction (2026-09, Manors go-live): re-reads the identity's
    *current* status here, at redemption time — never trusts that it's
    still eligible just because a token was validly issued for it earlier.
    A token issued while `active` fails closed (`identity_not_eligible`,
    same as an invalid/expired token — no distinguishing detail leaked) if
    the identity has since become `pending`/`locked`/`disabled`/`deleted`.
    Nothing is mutated on this path — the token is not marked used and no
    password is touched, so a transient state (e.g. a lockout that later
    expires) doesn't permanently burn an otherwise-valid, unexpired token. */
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

  const identity = await getIdentityById(record.identityId, dataAdapterMode);
  if (!isIdentityEligibleForPasswordReset(identity)) {
    return { success: false, reason: 'identity_not_eligible' };
  }

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
