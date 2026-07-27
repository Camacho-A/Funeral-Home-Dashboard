import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixEmailVerificationTokenItem,
  buildWixEmailVerificationTokenData,
  applyEmailVerificationTokenUpdateToWixData,
  type WixEmailVerificationTokenItem,
} from '../lib/wixEmailVerificationTokenMapper';
import { generateToken, verifyTokenHash, hashToken } from '../lib/identity/tokens';
import type { EmailVerificationToken } from '../types/emailVerificationToken';
import { getIdentityById, updateIdentity } from './identityService';
import { emailVerificationTokenFixtures } from './__mocks__/identityFixtures';

/**
 * Phase 21 (Identity, Authentication & Session Management). Email
 * verification — the same token type also drives invitation acceptance
 * (see `types/membership.ts`'s own comment); `services/invitationService.ts`
 * calls `createVerificationToken` directly rather than duplicating this
 * logic.
 */
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function nowIso(): string {
  return new Date().toISOString();
}

async function findTokenByHash(tokenHash: string, dataAdapterMode: DataAdapterMode): Promise<EmailVerificationToken | null> {
  if (dataAdapterMode === 'mock') {
    return emailVerificationTokenFixtures.find((t) => t.tokenHash === tokenHash) ?? null;
  }
  const response = await queryWixDataItems<WixEmailVerificationTokenItem>('emailVerificationTokens', {
    filter: { tokenHash },
    paging: { limit: 1 },
  });
  return mapWixEmailVerificationTokenItem(response.dataItems[0]?.data);
}

export async function createVerificationToken(
  identityId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ token: string }> {
  const { token, tokenHash } = generateToken();
  const now = nowIso();
  const record: EmailVerificationToken = {
    id: idFactory(),
    identityId,
    tokenHash,
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString(),
    usedAt: null,
    createdAt: now,
  };

  if (dataAdapterMode === 'mock') {
    emailVerificationTokenFixtures.push(record);
    return { token };
  }

  await insertWixDataItem<WixEmailVerificationTokenItem>('emailVerificationTokens', buildWixEmailVerificationTokenData(record), record.id);
  return { token };
}

/** "Resend verification"/"Expired token replacement" are the same
    operation: issue a fresh token. The old one, if any, is simply left to
    expire (or is already `usedAt`/expired) rather than deleted — an
    already-expired or already-used token can never be replayed regardless
    of how many newer ones exist. */
export async function resendVerification(
  identityId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ token: string }> {
  return createVerificationToken(identityId, idFactory, dataAdapterMode);
}

export type VerifyEmailResult =
  | { success: true; identityId: string }
  | { success: false; reason: 'invalid_token' | 'expired_token' | 'already_used' };

export async function verifyEmailWithToken(rawToken: string, dataAdapterMode: DataAdapterMode): Promise<VerifyEmailResult> {
  const tokenHash = hashToken(rawToken);
  const record = await findTokenByHash(tokenHash, dataAdapterMode);
  if (!record || !verifyTokenHash(rawToken, record.tokenHash)) {
    return { success: false, reason: 'invalid_token' };
  }
  if (record.usedAt) return { success: false, reason: 'already_used' };
  if (new Date(record.expiresAt).getTime() < Date.now()) return { success: false, reason: 'expired_token' };

  await markTokenUsed(record, dataAdapterMode);

  const identity = await getIdentityById(record.identityId, dataAdapterMode);
  if (identity) {
    await updateIdentity(
      record.identityId,
      { emailVerified: true, status: identity.status === 'pending' ? 'active' : identity.status },
      dataAdapterMode,
    );
  }

  return { success: true, identityId: record.identityId };
}

async function markTokenUsed(token: EmailVerificationToken, dataAdapterMode: DataAdapterMode): Promise<void> {
  const usedAt = nowIso();
  if (dataAdapterMode === 'mock') {
    const index = emailVerificationTokenFixtures.findIndex((t) => t.id === token.id);
    if (index !== -1) emailVerificationTokenFixtures[index] = { ...emailVerificationTokenFixtures[index], usedAt };
    return;
  }
  const response = await queryWixDataItems<WixEmailVerificationTokenItem>('emailVerificationTokens', {
    filter: { beaconTokenId: token.id },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const merged = applyEmailVerificationTokenUpdateToWixData(existingItem.data, { usedAt });
  await updateWixDataItem('emailVerificationTokens', existingItem.id, merged);
}
