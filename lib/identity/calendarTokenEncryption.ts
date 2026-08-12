import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). OAuth access/refresh tokens for a `CalendarConnection`
 * are per-*staff-member* — potentially many, user-provisioned,
 * rotatable — the same cardinality/provisioning profile
 * `mfaSecretEncryption.ts` (Phase 21) already established a real
 * precedent for, structurally identical construction: AES-256-GCM,
 * random 12-byte IV, `iv‖authTag‖ciphertext` base64-encoded together,
 * key derived via SHA-256 from a server-only env var (always exactly
 * 32 bytes regardless of the raw value's own length), same
 * dev-fallback/prod-hard-fail shape as `getSessionSecret()`.
 *
 * Deliberately a **separate** key (`CALENDAR_TOKEN_ENCRYPTION_KEY`),
 * not a reuse of `MFA_ENCRYPTION_KEY` — there is no precedent anywhere
 * in this codebase for sharing one secret-class key across unrelated
 * secret classes, and a compromise of one should never expose the
 * other. See docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md.
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CALENDAR_TOKEN_ENCRYPTION_KEY is not set. A real, random 32-byte key is required in production.');
    }
    // Development-only fallback, exactly like lib/env.ts's getSessionSecret
    // and mfaSecretEncryption.ts's own getEncryptionKey — deterministic so
    // calendar-connection tests/dev flows round-trip without configuration,
    // but never used in production.
    return createHash('sha256').update('beacon-development-only-insecure-calendar-token-key-do-not-use-in-production').digest();
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptCalendarToken(token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // AES-GCM standard IV length
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptCalendarToken(ciphertext: string): string {
  const key = getEncryptionKey();
  const raw = Buffer.from(ciphertext, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
