import { describe, expect, it } from 'vitest';
import { initialsFromName, toDisplayTitleCase, toDisplayCasingIfAllCaps } from './string';

/**
 * Item #6 clarification (2026-09): the previous `initialsFromName` sliced
 * the first two characters of the whole name string, which produced "AN"
 * for "Angelica Camacho" (the first two letters of just the first name)
 * instead of the correct first-name-initial + last-name-initial "AC". These
 * tests pin the corrected first-word/last-word behavior directly.
 */
describe('initialsFromName', () => {
  it('1: "Angelica Camacho" -> "AC"', () => {
    expect(initialsFromName('Angelica Camacho')).toBe('AC');
  });

  it('2: does not produce "AN" for "Angelica Camacho"', () => {
    expect(initialsFromName('Angelica Camacho')).not.toBe('AN');
  });

  it('3: uses the first and last word of the name, not a raw slice of the string', () => {
    // A raw two-character slice of "Angelica Camacho" would be "An" -> "AN".
    // The correct behavior takes the first letter of the first word and the
    // first letter of the last word instead.
    const result = initialsFromName('Angelica Camacho');
    expect(result[0]).toBe('A'); // first letter of the first word ("Angelica")
    expect(result[1]).toBe('C'); // first letter of the last word ("Camacho"), never the
    // second letter of the first word
  });

  it('4a: "John Smith" -> "JS"', () => {
    expect(initialsFromName('John Smith')).toBe('JS');
  });

  it('4b: "Maria Rodriguez" -> "MR"', () => {
    expect(initialsFromName('Maria Rodriguez')).toBe('MR');
  });

  it('5a: single-name fallback uses that name\'s own first initial only ("Cher" -> "C")', () => {
    expect(initialsFromName('Cher')).toBe('C');
  });

  it('5b: single-name fallback never invents a second letter from anywhere else', () => {
    const result = initialsFromName('Cher');
    expect(result).toHaveLength(1);
  });

  it('ignores a middle name — takes the first and last word only, never the middle one', () => {
    expect(initialsFromName('Angelica Maria Camacho')).toBe('AC');
  });

  it('collapses extra whitespace between words', () => {
    expect(initialsFromName('  Angelica   Camacho  ')).toBe('AC');
  });

  it('returns an empty string for an empty name rather than throwing', () => {
    expect(initialsFromName('')).toBe('');
  });
});

/**
 * SOLIS true redesign, Phase 1 — visual fidelity correction (2026-10).
 * Presentation-only title-case for stored names (the typography spec's
 * own "LOUIS BARBER" -> "Louis Barber" example) — never mutates the
 * underlying value, purely a render-time transform callers apply.
 */
describe('toDisplayTitleCase', () => {
  it('converts an all-caps name to title case', () => {
    expect(toDisplayTitleCase('LOUIS BARBER')).toBe('Louis Barber');
  });

  it('converts an all-lowercase name to title case', () => {
    expect(toDisplayTitleCase('louis barber')).toBe('Louis Barber');
  });

  it('leaves an already-correct title-case name unchanged', () => {
    expect(toDisplayTitleCase('Louis Barber')).toBe('Louis Barber');
  });

  it('capitalizes after a hyphen', () => {
    expect(toDisplayTitleCase('MARY-JANE SMITH')).toBe('Mary-Jane Smith');
  });

  it('handles a three-word name', () => {
    expect(toDisplayTitleCase('EVARISTA SILVA RIVERO')).toBe('Evarista Silva Rivero');
  });

  it('does not throw on an empty string', () => {
    expect(toDisplayTitleCase('')).toBe('');
  });
});

/**
 * Invitation email organization-name casing (2026-10). Only an entirely
 * ALL-CAPS stored name is normalized — anything with even one existing
 * lowercase letter is left completely untouched, since there is no
 * reliable way to tell "all-caps by data-entry habit" apart from
 * "genuinely all-caps by design" from the stored string alone.
 */
describe('toDisplayCasingIfAllCaps', () => {
  it('"MANORS CREMATION" -> "Manors Cremation"', () => {
    expect(toDisplayCasingIfAllCaps('MANORS CREMATION')).toBe('Manors Cremation');
  });

  it('leaves an already normally-cased organization name unchanged', () => {
    expect(toDisplayCasingIfAllCaps('Manors Cremation')).toBe('Manors Cremation');
  });

  it('leaves a name with intentional mixed casing / an embedded acronym untouched — not entirely uppercase', () => {
    expect(toDisplayCasingIfAllCaps('Acme HVAC Co.')).toBe('Acme HVAC Co.');
  });

  it('leaves a lowercase-stylized brand name untouched', () => {
    expect(toDisplayCasingIfAllCaps('manorsCremation')).toBe('manorsCremation');
  });

  it('capitalizes after a hyphen in an all-caps name, same as toDisplayTitleCase', () => {
    expect(toDisplayCasingIfAllCaps('MARY-JANE CREMATORY')).toBe('Mary-Jane Crematory');
  });

  it('a value with no letters at all is left untouched — nothing to normalize', () => {
    expect(toDisplayCasingIfAllCaps('12345')).toBe('12345');
  });

  it('an all-caps value mixed with digits/punctuation still normalizes its letters', () => {
    expect(toDisplayCasingIfAllCaps('1-800-CREMATE')).toBe('1-800-Cremate');
  });

  it('does not throw on an empty string', () => {
    expect(toDisplayCasingIfAllCaps('')).toBe('');
  });
});
