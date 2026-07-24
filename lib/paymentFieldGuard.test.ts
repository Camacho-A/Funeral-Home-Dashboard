import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PAYMENT_FIELD_KEYS, findForbiddenPaymentFields } from './paymentFieldGuard';

/**
 * Phase 19A (Secure Payment Architecture). Direct unit tests for the one
 * shared server-side guard every Route Handler / DTO validator that
 * accepts a request body wires in — see that file's own comment for why
 * this is a flat literal-key check, not a content scan.
 */
describe('findForbiddenPaymentFields', () => {
  it('returns an empty array for a body with none of the forbidden keys', () => {
    expect(findForbiddenPaymentFields({ decedentName: 'Test', nextOfKinPhone: '555-0000' })).toEqual([]);
  });

  it.each(FORBIDDEN_PAYMENT_FIELD_KEYS)('flags a body containing the forbidden key "%s"', (key) => {
    expect(findForbiddenPaymentFields({ [key]: 'anything' })).toContain(key);
  });

  it('flags every forbidden key present at once, not just the first', () => {
    const found = findForbiddenPaymentFields({
      cardNumber: '4111111111111111',
      cardCvv: '123',
      decedentName: 'Test',
    });
    expect(found.sort()).toEqual(['cardCvv', 'cardNumber']);
  });

  it('is not fooled by a nested object — only checks direct properties of what it is given', () => {
    // Callers are responsible for checking each nested object they care
    // about (the case Route Handlers explicitly check both the top-level
    // body and the nested `patch` object) — this function itself is
    // intentionally shallow.
    expect(findForbiddenPaymentFields({ patch: { cardNumber: '4111111111111111' } })).toEqual([]);
  });

  it('returns an empty array for non-object input', () => {
    expect(findForbiddenPaymentFields(null)).toEqual([]);
    expect(findForbiddenPaymentFields(undefined)).toEqual([]);
    expect(findForbiddenPaymentFields('a string')).toEqual([]);
    expect(findForbiddenPaymentFields(42)).toEqual([]);
  });

  it('returns an empty array for an array, even one containing forbidden-looking objects', () => {
    expect(findForbiddenPaymentFields([{ cardNumber: '4111111111111111' }])).toEqual([]);
  });

  it('does not flag a key that merely contains a forbidden substring', () => {
    // e.g. a hypothetical "cardNumberVerified" boolean flag is not the
    // literal "cardNumber" key and must not trip this guard.
    expect(findForbiddenPaymentFields({ cardNumberVerified: true })).toEqual([]);
  });
});
