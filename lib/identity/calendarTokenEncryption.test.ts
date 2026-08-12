import { afterEach, describe, expect, it } from 'vitest';
import { decryptCalendarToken, encryptCalendarToken } from './calendarTokenEncryption';

afterEach(() => {
  delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
});

describe('encryptCalendarToken / decryptCalendarToken', () => {
  it('round-trips an OAuth token through encryption and decryption', () => {
    const token = 'ya29.a0AfH6SMB-fake-google-access-token-value';
    const ciphertext = encryptCalendarToken(token);
    expect(decryptCalendarToken(ciphertext)).toBe(token);
  });

  it('never stores the plaintext token in the ciphertext', () => {
    const token = 'M.R3_BAY.fake-microsoft-refresh-token-value';
    const ciphertext = encryptCalendarToken(token);
    expect(ciphertext).not.toContain(token);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const token = 'a-real-oauth-token';
    expect(encryptCalendarToken(token)).not.toBe(encryptCalendarToken(token));
  });

  it('round-trips correctly with a custom CALENDAR_TOKEN_ENCRYPTION_KEY set', () => {
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'a-real-production-style-random-key-value';
    const token = 'a-real-oauth-token';
    const ciphertext = encryptCalendarToken(token);
    expect(decryptCalendarToken(ciphertext)).toBe(token);
  });

  it('fails to decrypt with a mismatched key (tamper/key-rotation detection)', () => {
    const token = 'a-real-oauth-token';
    const ciphertext = encryptCalendarToken(token);
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(() => decryptCalendarToken(ciphertext)).toThrow();
  });

  it('is independent of MFA_ENCRYPTION_KEY — a different key produces incompatible ciphertext', () => {
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'calendar-specific-key';
    const token = 'a-real-oauth-token';
    const ciphertext = encryptCalendarToken(token);
    // Simulate MFA's own key being set differently — must not affect this module at all.
    process.env.MFA_ENCRYPTION_KEY = 'mfa-specific-key';
    expect(decryptCalendarToken(ciphertext)).toBe(token);
    delete process.env.MFA_ENCRYPTION_KEY;
  });
});
