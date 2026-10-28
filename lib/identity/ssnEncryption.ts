import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Case SSN (2026-10). A decedent's Social Security number, captured from
 * the case's Arrangement Form and kept on the case, encrypted at rest.
 * The same construction as calendarTokenEncryption.ts / mfaSecretEncryption.ts
 * — AES-256-GCM, random 12-byte IV, `iv‖authTag‖ciphertext` base64, key
 * derived via SHA-256 from a server-only env var — and, like them, its own
 * separate key (`SSN_ENCRYPTION_KEY`): a compromise of one secret class
 * never exposes another.
 *
 * Unlike those, a missing key in production does not throw into a request:
 * `isSsnEncryptionConfigured()` lets callers skip capture cleanly (the
 * Manatee application then asks staff for the number) until the key is set.
 */
const DEVELOPMENT_KEY = 'beacon-development-only-insecure-ssn-key-do-not-use-in-production';

export function isSsnEncryptionConfigured(): boolean {
  return Boolean(process.env.SSN_ENCRYPTION_KEY) || process.env.NODE_ENV !== 'production';
}

function getEncryptionKey(): Buffer {
  const raw = process.env.SSN_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SSN_ENCRYPTION_KEY is not set. A real, random 32-byte key is required in production.');
    }
    return createHash('sha256').update(DEVELOPMENT_KEY).digest();
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptSsn(ssn: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(ssn, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptSsn(ciphertext: string): string {
  const key = getEncryptionKey();
  const raw = Buffer.from(ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
