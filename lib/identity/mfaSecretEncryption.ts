import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Phase 21 (Identity, Authentication & Session Management). The phase's
 * own spec calls for storing a TOTP secret as `secretReference` — an
 * indirection, never the raw secret. Unlike Clover's `merchantIdReference`
 * (Phase 19B/20), which names an *env var* (there are only a handful of
 * organizations, so one env var per credential is practical), a TOTP
 * secret is per-*identity* — there could be thousands, so "reference"
 * here means an **encrypted value**, not an env-var name: `identities.
 * mfaSecretReference` stores AES-256-GCM ciphertext (base64), decryptable
 * only with a server-only key (`MFA_ENCRYPTION_KEY`) that never leaves
 * this module. The raw TOTP secret is never persisted anywhere in
 * plaintext. See ADR-025's own note on this deliberate reinterpretation
 * of "reference."
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MFA_ENCRYPTION_KEY is not set. A real, random 32-byte key is required in production.');
    }
    // Development-only fallback, exactly like lib/env.ts's getSessionSecret
    // — deterministic so mock-mode MFA setup/verification round-trips
    // without requiring configuration, but never used in production.
    return createHash('sha256').update('beacon-development-only-insecure-mfa-key-do-not-use-in-production').digest();
  }
  return createHash('sha256').update(raw).digest(); // always exactly 32 bytes for AES-256, regardless of the raw env value's own length
}

export function encryptTotpSecret(secretBase32: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // AES-GCM standard IV length
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptTotpSecret(reference: string): string {
  const key = getEncryptionKey();
  const raw = Buffer.from(reference, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
