import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptSsn, encryptSsn, isSsnEncryptionConfigured } from './ssnEncryption';

/** Fictional (000-xx-xxxx is never issued). */
describe('ssnEncryption', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips, never stores the digits readable, and uses a fresh IV each time', () => {
    const a = encryptSsn('000-12-3456');
    const b = encryptSsn('000-12-3456');
    expect(decryptSsn(a)).toBe('000-12-3456');
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64').toString('latin1')).not.toContain('3456');
  });

  it('a different key cannot read it', () => {
    vi.stubEnv('SSN_ENCRYPTION_KEY', 'key-one');
    const sealed = encryptSsn('000-12-3456');
    vi.stubEnv('SSN_ENCRYPTION_KEY', 'key-two');
    expect(() => decryptSsn(sealed)).toThrow();
  });

  it('in production, without its own key, it is not configured (capture is skipped) and never falls back', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SSN_ENCRYPTION_KEY', '');
    expect(isSsnEncryptionConfigured()).toBe(false);
    expect(() => encryptSsn('000-12-3456')).toThrow('SSN_ENCRYPTION_KEY is not set');
    vi.stubEnv('SSN_ENCRYPTION_KEY', 'a-real-key');
    expect(isSsnEncryptionConfigured()).toBe(true);
  });
});
