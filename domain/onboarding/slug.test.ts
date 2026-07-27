import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, isReservedSlug, isValidSlugShape, normalizeSlugCandidate, slugWithSuffix } from './slug';

describe('normalizeSlugCandidate', () => {
  it('matches the spec\'s own worked examples', () => {
    expect(normalizeSlugCandidate("Manor's Cremation")).toBe('manors-cremation');
    expect(normalizeSlugCandidate('Smith Family Funeral Home')).toBe('smith-family-funeral-home');
  });

  it('lowercases and collapses punctuation/whitespace runs into single hyphens', () => {
    expect(normalizeSlugCandidate('  A & B   Funeral--Home!! ')).toBe('a-b-funeral-home');
  });

  it('strips leading/trailing hyphens', () => {
    expect(normalizeSlugCandidate('-Leading and Trailing-')).toBe('leading-and-trailing');
  });

  it('falls back to "organization" for input that normalizes to nothing', () => {
    expect(normalizeSlugCandidate('!!!')).toBe('organization');
    expect(normalizeSlugCandidate('')).toBe('organization');
  });

  it('truncates to the maximum slug length', () => {
    const long = 'a'.repeat(200);
    expect(normalizeSlugCandidate(long).length).toBeLessThanOrEqual(60);
  });

  it('never throws for any string input', () => {
    expect(() => normalizeSlugCandidate('日本語 funeral home 123')).not.toThrow();
  });
});

describe('isReservedSlug / RESERVED_SLUGS', () => {
  it('rejects every example the phase spec explicitly named', () => {
    for (const reserved of ['admin', 'api', 'login', 'payments', 'settings', 'support', 'beacon']) {
      expect(isReservedSlug(reserved)).toBe(true);
      expect(RESERVED_SLUGS.has(reserved)).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(isReservedSlug('ADMIN')).toBe(true);
    expect(isReservedSlug('Api')).toBe(true);
  });

  it('accepts an ordinary organization name', () => {
    expect(isReservedSlug('manors-cremation')).toBe(false);
  });
});

describe('isValidSlugShape', () => {
  it('accepts well-formed slugs', () => {
    expect(isValidSlugShape('manors-cremation')).toBe(true);
    expect(isValidSlugShape('smith-family-funeral-home')).toBe(true);
    expect(isValidSlugShape('abc')).toBe(true);
  });

  it('rejects uppercase, spaces, leading/trailing/doubled hyphens, and empty strings', () => {
    expect(isValidSlugShape('Manors-Cremation')).toBe(false);
    expect(isValidSlugShape('manors cremation')).toBe(false);
    expect(isValidSlugShape('-manors')).toBe(false);
    expect(isValidSlugShape('manors-')).toBe(false);
    expect(isValidSlugShape('manors--cremation')).toBe(false);
    expect(isValidSlugShape('')).toBe(false);
  });
});

describe('slugWithSuffix', () => {
  it('returns the base slug unchanged on the first attempt', () => {
    expect(slugWithSuffix('manors-cremation', 1)).toBe('manors-cremation');
  });

  it('appends a numbered suffix on collision retries', () => {
    expect(slugWithSuffix('manors-cremation', 2)).toBe('manors-cremation-2');
    expect(slugWithSuffix('manors-cremation', 3)).toBe('manors-cremation-3');
  });
});
