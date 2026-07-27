import { describe, expect, it } from 'vitest';
import { isValidEmailShape, normalizeEmail } from './email';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Dana@ManagedCremations.Test  ')).toBe('dana@managedcremations.test');
  });

  it('is idempotent', () => {
    const once = normalizeEmail('Dana@Example.com');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('isValidEmailShape', () => {
  it('accepts a well-formed email', () => {
    expect(isValidEmailShape('dana@example.com')).toBe(true);
  });

  it('rejects a malformed email', () => {
    expect(isValidEmailShape('not-an-email')).toBe(false);
    expect(isValidEmailShape('missing@domain')).toBe(false);
    expect(isValidEmailShape('')).toBe(false);
  });
});
