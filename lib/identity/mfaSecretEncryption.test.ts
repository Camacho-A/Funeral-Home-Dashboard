import { afterEach, describe, expect, it } from 'vitest';
import { decryptTotpSecret, encryptTotpSecret } from './mfaSecretEncryption';
import { generateTotpSecret } from './totp';

afterEach(() => {
  delete process.env.MFA_ENCRYPTION_KEY;
});

describe('encryptTotpSecret / decryptTotpSecret', () => {
  it('round-trips a secret through encryption and decryption', () => {
    const secret = generateTotpSecret();
    const reference = encryptTotpSecret(secret);
    expect(decryptTotpSecret(reference)).toBe(secret);
  });

  it('never stores the plaintext secret in the encrypted reference', () => {
    const secret = generateTotpSecret();
    const reference = encryptTotpSecret(secret);
    expect(reference).not.toContain(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const secret = generateTotpSecret();
    expect(encryptTotpSecret(secret)).not.toBe(encryptTotpSecret(secret));
  });

  it('round-trips correctly with a custom MFA_ENCRYPTION_KEY set', () => {
    process.env.MFA_ENCRYPTION_KEY = 'a-real-production-style-random-key-value';
    const secret = generateTotpSecret();
    const reference = encryptTotpSecret(secret);
    expect(decryptTotpSecret(reference)).toBe(secret);
  });

  it('fails to decrypt with a mismatched key (tamper/key-rotation detection)', () => {
    const secret = generateTotpSecret();
    const reference = encryptTotpSecret(secret);
    process.env.MFA_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(() => decryptTotpSecret(reference)).toThrow();
  });
});
