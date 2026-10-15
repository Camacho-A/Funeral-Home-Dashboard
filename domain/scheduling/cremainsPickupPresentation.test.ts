import { describe, expect, it } from 'vitest';
import {
  compactCaseNumber,
  cremainsChipLabel,
  deriveSurname,
  formatPickupDate,
  formatCaseDateOfDeath,
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

describe('formatCaseDateOfDeath (2026-10)', () => {
  it('formats a case date in the same long form as every other date in the popup', () => {
    expect(formatCaseDateOfDeath('10/09/2026')).toBe('Friday, October 9, 2026');
    expect(formatCaseDateOfDeath('10/09/2026')).toBe(formatPickupDate('2026-10-09'));
  });

  it('reads as not-recorded rather than guessing, when there is no usable value', () => {
    // Never today's date, and never a partial parse — a case with no
    // recorded date of death must not appear to have one.
    for (const value of [null, undefined, '', '   ', 'unknown', '2026-10-09', '9/10/2026', '10/09/26']) {
      expect(formatCaseDateOfDeath(value), String(value)).toBeNull();
    }
  });

  it('ignores surrounding whitespace', () => {
    expect(formatCaseDateOfDeath('  10/09/2026  ')).toBe('Friday, October 9, 2026');
  });

  it('is timezone-stable — the date shown is the date stored', () => {
    // A naive new Date("10/09/2026") would shift by a day for viewers
    // behind UTC. The first of a month is where that shows up worst.
    expect(formatCaseDateOfDeath('01/01/2026')).toBe('Thursday, January 1, 2026');
    expect(formatCaseDateOfDeath('12/31/2026')).toBe('Thursday, December 31, 2026');
  });
});

describe('cremains labels use the case own number/prefix (organization-specific numbering, 2026-10)', () => {
  it('compacts a Gus Camacho (M) number without assuming "B"', () => {
    expect(compactCaseNumber('M2026-004')).toBe('004');
    expect(compactCaseNumber('AB2027-1200')).toBe('1200');
  });

  it('renders an M case with its own number in full and compact forms', () => {
    const gusCase = { caseNumber: 'M2026-004', decedentName: 'JOHN TEST DOE' };
    expect(cremainsChipLabel(gusCase)).toBe('M2026-004 · Doe');
    expect(cremainsChipLabel(gusCase, { compact: true })).toBe('004 · Doe');
  });

  it('never rewrites a number into another prefix', () => {
    expect(cremainsChipLabel({ caseNumber: 'M2026-004', decedentName: '' })).toBe('M2026-004');
    expect(compactCaseNumber('m2026-004')).toBe('m2026-004');
  });
});
