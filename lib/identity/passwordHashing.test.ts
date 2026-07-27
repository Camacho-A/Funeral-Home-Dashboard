import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwordHashing';

describe('hashPassword / verifyPassword', () => {
  it('verifies the correct password against its own hash', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('never stores the plaintext password in the hash output', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('produces a different hash each time (random salt)', () => {
    const first = hashPassword('same password');
    const second = hashPassword('same password');
    expect(first).not.toBe(second);
    expect(verifyPassword('same password', first)).toBe(true);
    expect(verifyPassword('same password', second)).toBe(true);
  });

  it('rejects a malformed stored hash rather than throwing', () => {
    expect(verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
  });
});
