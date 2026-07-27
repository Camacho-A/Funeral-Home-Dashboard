import { describe, expect, it } from 'vitest';
import { generateTotpCode, generateTotpSecret, verifyTotpCode } from './totp';

describe('generateTotpSecret', () => {
  it('generates a base32-shaped secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThan(0);
  });

  it('generates a different secret on every call', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe('generateTotpCode / verifyTotpCode', () => {
  it('verifies a code generated for the same time window', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = generateTotpCode(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
  });

  it('rejects a code from a different secret', () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = generateTotpCode(secretA, now);
    expect(verifyTotpCode(secretB, code, now)).toBe(false);
  });

  it('tolerates one step of clock drift in either direction', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const codeOneStepAhead = generateTotpCode(secret, now + 30_000);
    expect(verifyTotpCode(secret, codeOneStepAhead, now)).toBe(true);
  });

  it('rejects a code more than the tolerated window away', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const codeFarAhead = generateTotpCode(secret, now + 300_000); // 10 steps ahead
    expect(verifyTotpCode(secret, codeFarAhead, now)).toBe(false);
  });

  it('produces the same code deterministically for the same secret+time', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(generateTotpCode(secret, now)).toBe(generateTotpCode(secret, now));
  });
});
