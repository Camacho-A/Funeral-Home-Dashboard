/** Phase 21 (Identity, Authentication & Session Management). Same
    single-use, hash-only shape as `EmailVerificationToken` — kept as a
    separate type/collection since the two are issued and consumed by
    genuinely different flows (signup/invitation vs. forgot-password) even
    though they share a structure. See `domain/identity/tokens.ts`. */
export type PasswordResetToken = {
  id: string;
  identityId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};
