import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/**
 * Phase 21 (Identity, Authentication & Session Management). Single-use
 * verification/reset tokens — shared by `EmailVerificationToken` and
 * `PasswordResetToken`. "Store only token hashes. Never persist plaintext
 * verification tokens": `generateToken()` returns the raw token (to hand
 * to whoever sends the email — never logged, never persisted) and its
 * hash (the only thing written to Wix) as two separate values; nothing in
 * this module, or any caller, ever writes the raw value anywhere.
 */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison against a stored hash. */
export function verifyTokenHash(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
