import type { PasswordResetToken } from '../types/passwordResetToken';

export type WixPasswordResetTokenItem = {
  beaconTokenId?: unknown;
  identityId?: unknown;
  tokenHash?: unknown;
  expiresAt?: unknown;
  usedAt?: unknown;
  createdAt?: unknown;
};

export function mapWixPasswordResetTokenItem(item: WixPasswordResetTokenItem | undefined): PasswordResetToken | null {
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

export function buildWixPasswordResetTokenData(token: PasswordResetToken): WixPasswordResetTokenItem {
  return {
    beaconTokenId: token.id,
    identityId: token.identityId,
    tokenHash: token.tokenHash,
    expiresAt: token.expiresAt,
    usedAt: token.usedAt,
    createdAt: token.createdAt,
  };
}

export function applyPasswordResetTokenUpdateToWixData(
  existing: WixPasswordResetTokenItem,
  patch: Partial<PasswordResetToken>,
): WixPasswordResetTokenItem {
  const next = { ...existing };
  if (patch.usedAt !== undefined) next.usedAt = patch.usedAt;
  return next;
}
