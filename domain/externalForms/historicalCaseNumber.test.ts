import { describe, expect, it } from 'vitest';
import { deriveHistoricalCaseNumber, describePrefixMismatch } from './historicalCaseNumber';

// Synthetic fixtures only — no real family/decedent/case data.

describe('deriveHistoricalCaseNumber', () => {
  it('I: qid 1 and qid 198 agree -> ok, normalized to B{year}-{seq}', () => {
    const answers = { '1': { answer: '2026-035' }, '198': { answer: '2026-035' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result).toEqual({ status: 'ok', caseNumber: 'B2026-035' });
  });

  it('J: qid 198 blank -> ok, sourced from qid 1 alone', () => {
    const answers = { '1': { answer: '2026-035' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result).toEqual({ status: 'ok', caseNumber: 'B2026-035' });
  });

  it('K: qid 1 / qid 198 disagreement blocks', () => {
    const answers = { '1': { answer: '2026-035' }, '198': { answer: '2026-036' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result.status).toBe('disagreement');
    if (result.status === 'disagreement') {
      expect(result.primary).toBe('B2026-035');
      expect(result.secondary).toBe('B2026-036');
    }
  });

  it('K2: a malformed qid 198 (present but unparseable) also blocks as a disagreement, never silently ignored', () => {
    const answers = { '1': { answer: '2026-035' }, '198': { answer: 'not-a-case-number' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result.status).toBe('disagreement');
  });

  it('L: a malformed qid 1 blocks', () => {
    const answers = { '1': { answer: 'not-a-case-number' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result).toEqual({ status: 'malformed', raw: 'not-a-case-number' });
  });

  it('L2: qid 1 missing entirely blocks with "missing"', () => {
    const result = deriveHistoricalCaseNumber({});
    expect(result).toEqual({ status: 'missing' });
  });

  it('L3: a plausible-looking but out-of-range year is rejected as malformed', () => {
    const answers = { '1': { answer: '1899-001' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result.status).toBe('malformed');
  });

  it('L4: a zero/negative sequence is rejected as malformed', () => {
    const answers = { '1': { answer: '2026-000' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result.status).toBe('malformed');
  });

  it('M: qid 251 (Unique ID) is never used, even when present and numerically different', () => {
    const answers = {
      '1': { answer: '2026-035' },
      '251': { answer: '2026-036' }, // Jotform's own internal autoincrement — must have zero effect
    };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result).toEqual({ status: 'ok', caseNumber: 'B2026-035' });
  });

  it('sequence is zero-padded to 3 digits via the existing formatCaseNumber utility', () => {
    const answers = { '1': { answer: '2026-5' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result).toEqual({ status: 'ok', caseNumber: 'B2026-005' });
  });

  it('a 4-digit sequence beyond 999 is preserved, not truncated', () => {
    const answers = { '1': { answer: '2026-1200' } };
    const result = deriveHistoricalCaseNumber(answers);
    expect(result).toEqual({ status: 'ok', caseNumber: 'B2026-1200' });
  });
});

/**
 * Organization-specific numbering (2026-10): the importing organization's
 * prefix is applied, and a raw value carrying a different explicit prefix
 * is rejected — a Gus (M) import can never accept or produce a B number.
 */
describe('deriveHistoricalCaseNumber — prefix-aware', () => {
  it('formats an unprefixed raw value with the organization prefix (M for Gus)', () => {
    const answers = { '1': { answer: '2026-012' }, '198': { answer: '2026-012' } };
    expect(deriveHistoricalCaseNumber(answers, 'M')).toEqual({ status: 'ok', caseNumber: 'M2026-012' });
  });

  it('accepts a raw value already carrying the matching prefix (any case)', () => {
    expect(deriveHistoricalCaseNumber({ '1': { answer: 'M2026-012' } }, 'M')).toEqual({ status: 'ok', caseNumber: 'M2026-012' });
    expect(deriveHistoricalCaseNumber({ '1': { answer: 'm2026-12' } }, 'M')).toEqual({ status: 'ok', caseNumber: 'M2026-012' });
    expect(deriveHistoricalCaseNumber({ '1': { answer: 'B2026-035' } })).toEqual({ status: 'ok', caseNumber: 'B2026-035' });
  });

  it('rejects a B number imported into an M organization with a clear reason', () => {
    const result = deriveHistoricalCaseNumber({ '1': { answer: 'B2026-035' } }, 'M');
    expect(result).toEqual({ status: 'prefix_mismatch', raw: 'B2026-035', foundPrefix: 'B', expectedPrefix: 'M' });
    if (result.status === 'prefix_mismatch') {
      expect(describePrefixMismatch(result)).toMatch(/uses the "B" case-number prefix, but this organization's case numbers use "M"/);
    }
  });

  it('rejects an M number imported into the (B) Manors organization', () => {
    expect(deriveHistoricalCaseNumber({ '1': { answer: 'M2026-004' } }, 'B').status).toBe('prefix_mismatch');
    expect(deriveHistoricalCaseNumber({ '1': { answer: 'M2026-004' } }).status).toBe('prefix_mismatch');
  });

  it('rejects a mismatched prefix on the secondary (qid 198) cross-check too', () => {
    const answers = { '1': { answer: '2026-012' }, '198': { answer: 'B2026-012' } };
    expect(deriveHistoricalCaseNumber(answers, 'M').status).toBe('prefix_mismatch');
  });
});
