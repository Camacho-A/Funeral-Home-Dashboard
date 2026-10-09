import { describe, expect, it } from 'vitest';
import {
  compactCaseNumber,
  cremainsChipLabel,
  deriveSurname,
  formatPickupDate,
  paperworkDateFromNotes,
} from './cremainsPickupPresentation';

/**
 * Calendar labelling (2026-10). A chip must say which case at a glance
 * without overflowing a month cell, and must never invent a case number.
 */
describe('deriveSurname', () => {
  it('takes the family name from an ordinary name', () => {
    expect(deriveSurname('Walter Boone')).toBe('Boone');
    expect(deriveSurname('EVARISTA SILVA RIVERO')).toBe('Rivero');
  });

  it('keeps a compound surname whole rather than taking the last word', () => {
    // The naive rule would yield "Berg" and "Cruz".
    expect(deriveSurname('Robert van der Berg')).toBe('Van Der Berg');
    expect(deriveSurname('Maria De La Cruz')).toBe('De La Cruz');
    expect(deriveSurname('Ludwig von Mises')).toBe('Von Mises');
    expect(deriveSurname('Ana dos Santos')).toBe('Dos Santos');
  });

  it('ignores generational and professional suffixes', () => {
    expect(deriveSurname('Harold Gus Camacho Jr.')).toBe('Camacho');
    expect(deriveSurname('Harold Camacho III')).toBe('Camacho');
    expect(deriveSurname('Susan Reyes MD')).toBe('Reyes');
  });

  it('handles hyphenated and apostrophe names as single units', () => {
    expect(deriveSurname('Jane Smith-Jones')).toBe('Smith-Jones');
    expect(deriveSurname("Sean O'Brien")).toBe("O'brien");
  });

  it('handles a single-word name', () => {
    expect(deriveSurname('Prince')).toBe('Prince');
  });

  it('never consumes the entire name when it is all particles', () => {
    expect(deriveSurname('van der')).toBe('Der');
  });

  it('returns null rather than guessing for an empty name', () => {
    expect(deriveSurname('')).toBeNull();
    expect(deriveSurname('   ')).toBeNull();
    expect(deriveSurname(null)).toBeNull();
    expect(deriveSurname(undefined)).toBeNull();
  });
});

describe('compactCaseNumber', () => {
  it('reduces a case number to its sequence', () => {
    expect(compactCaseNumber('B2026-035')).toBe('035');
    expect(compactCaseNumber('B2026-007')).toBe('007');
    expect(compactCaseNumber('B2026-137')).toBe('137');
  });

  it('returns an unparseable value unchanged rather than inventing a short form', () => {
    expect(compactCaseNumber('LEGACY-1')).toBe('LEGACY-1');
    expect(compactCaseNumber('')).toBe('');
  });
});

describe('cremainsChipLabel', () => {
  const case_ = { caseNumber: 'B2026-035', decedentName: 'EVARISTA SILVA RIVERO' };

  it('renders the full case number and surname', () => {
    expect(cremainsChipLabel(case_)).toBe('B2026-035 · Rivero');
  });

  it('renders a compact form for tight cells', () => {
    expect(cremainsChipLabel(case_, { compact: true })).toBe('035 · Rivero');
  });

  it('falls back safely when the case is not available, never inventing a number', () => {
    // An unauthorized, deleted or not-yet-loaded case resolves to nothing
    // here — the chip must not fabricate or borrow a case number.
    for (const missing of [null, undefined, { caseNumber: '', decedentName: 'X' }]) {
      expect(cremainsChipLabel(missing)).toBe('Cremains Pickup');
    }
  });

  it('shows the case number alone when the name is unusable', () => {
    expect(cremainsChipLabel({ caseNumber: 'B2026-035', decedentName: '' })).toBe('B2026-035');
  });

  it('never contains "All day" or a clock time', () => {
    const label = cremainsChipLabel(case_);
    expect(label).not.toMatch(/all day/i);
    expect(label).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('detail helpers', () => {
  it('formats a local date with no timezone conversion', () => {
    expect(formatPickupDate('2026-10-09')).toBe('Friday, October 9, 2026');
  });

  it('reports a paperwork date only when one was genuinely recorded', () => {
    expect(paperworkDateFromNotes('AUTOMATICALLY SCHEDULED FROM COMPLETED CREMATORY PAPERWORK ON 2026-10-02.')).toBe('2026-10-02');
    expect(paperworkDateFromNotes('Expected pickup entered by staff for 2026-10-09.')).toBeNull();
    expect(paperworkDateFromNotes(null)).toBeNull();
  });
});
