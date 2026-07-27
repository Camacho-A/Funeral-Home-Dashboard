import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, verifyTokenHash } from './tokens';

describe('generateToken / verifyTokenHash', () => {
  it('generates a token whose hash verifies successfully', () => {
    const { token, tokenHash } = generateToken();
    expect(verifyTokenHash(token, tokenHash)).toBe(true);
  });

  it('never returns the raw token as part of the hash', () => {
    const { token, tokenHash } = generateToken();
    expect(tokenHash).not.toContain(token);
  });

  it('rejects a wrong token against a real hash', () => {
    const { tokenHash } = generateToken();
    const { token: otherToken } = generateToken();
    expect(verifyTokenHash(otherToken, tokenHash)).toBe(false);
  });

  it('generates a different token on every call', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('hashToken is deterministic for the same input', () => {
    const { token } = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
