/**
 * Phase 21 (Identity, Authentication & Session Management). Single-use,
 * short-lived proof of email ownership — used both for a brand-new
 * identity's own signup verification and for accepting an invitation to
 * a second organization (see `types/membership.ts`'s own comment: there is
 * no separate "invitation token," this is the one token type that drives
 * both). Only ever stores a hash (`tokenHash`) — the plaintext token is
 * returned once, at creation time, to whoever triggered it (an email send,
 * in a real deployment), and is never persisted anywhere. See
 * `domain/identity/tokens.ts`.
 */
export type EmailVerificationToken = {
  id: string;
  identityId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};
