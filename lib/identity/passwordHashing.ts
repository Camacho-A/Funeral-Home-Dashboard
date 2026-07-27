import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Phase 21 (Identity, Authentication & Session Management). Password
 * hashing — Node's built-in `crypto.scrypt` (a real, slow, salted KDF),
 * not a hand-rolled hash and not a new dependency. Server-only (Route
 * Handlers/Server Actions run in the Node runtime, never edge middleware,
 * unlike lib/auth/sessionToken.ts's Web-Crypto-only constraint) — this
 * file must never be imported from middleware.ts.
 *
 * Stored format: `{saltHex}:{derivedKeyHex}` — a single string, so
 * `Identity`'s underlying Wix row only needs one `passwordHash` field,
 * never a separate salt column to keep in sync.
 */
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

/** Constant-time comparison — never a plain `===` on the derived hash,
    which would leak timing information about how many leading bytes
    matched. */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, derivedHex] = storedHash.split(':');
  if (!salt || !derivedHex) return false;

  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const stored = Buffer.from(derivedHex, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
