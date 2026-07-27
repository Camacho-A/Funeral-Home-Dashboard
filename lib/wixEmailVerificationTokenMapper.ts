import type { EmailVerificationToken } from '../types/emailVerificationToken';

export type WixEmailVerificationTokenItem = {
  beaconTokenId?: unknown;
  identityId?: unknown;
  tokenHash?: unknown;
  expiresAt?: unknown;
  usedAt?: unknown;
  createdAt?: unknown;
};

export function mapWixEmailVerificationTokenItem(
  item: WixEmailVerificationTokenItem | undefined,
): EmailVerificationToken | null {
  if (
    !item ||
    typeof item.beaconTokenId !== 'string' ||
    typeof item.identityId !== 'string' ||
    typeof item.tokenHash !== 'string' ||
    typeof item.expiresAt !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconTokenId,
    identityId: item.identityId,
    tokenHash: item.tokenHash,
    expiresAt: item.expiresAt,
    usedAt: typeof item.usedAt === 'string' ? item.usedAt : null,
    createdAt: item.createdAt,
  };
}

export function buildWixEmailVerificationTokenData(token: EmailVerificationToken): WixEmailVerificationTokenItem {
  return {
    beaconTokenId: token.id,
    identityId: token.identityId,
    tokenHash: token.tokenHash,
    expiresAt: token.expiresAt,
    usedAt: token.usedAt,
    createdAt: token.createdAt,
  };
}

export function applyEmailVerificationTokenUpdateToWixData(
  existing: WixEmailVerificationTokenItem,
  patch: Partial<EmailVerificationToken>,
): WixEmailVerificationTokenItem {
  const next = { ...existing };
  if (patch.usedAt !== undefined) next.usedAt = patch.usedAt;
  return next;
}
