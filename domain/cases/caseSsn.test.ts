import { describe, expect, it } from 'vitest';
import { caseSsnSummary, parseSsnCorrectionReason, readStoredCaseSsn } from './caseSsn';
import { mapWixCaseItem } from '@/lib/wixCaseMapper';
import { validateAndPickCaseUpdate } from '@/lib/wixCaseMapper';

const stored = { ciphertext: 'c2VhbGVk', last4: '3456', source: 'arrangement_form', capturedAt: '2026-10-28T12:00:00.000Z', capturedBy: null, correctedAt: null, correctedBy: null, correctionReason: null };

describe('case SSN record', () => {
  it('reads a well-formed record; anything malformed is treated as not on file', () => {
    expect(readStoredCaseSsn(stored)).toMatchObject({ last4: '3456', source: 'arrangement_form' });
    expect(readStoredCaseSsn({ ...stored, last4: '12345' })).toBeNull();
    expect(readStoredCaseSsn({ ...stored, source: 'typed' })).toBeNull();
    expect(readStoredCaseSsn({ ...stored, ciphertext: '' })).toBeNull();
    expect(readStoredCaseSsn('000-12-3456')).toBeNull();
  });

  it('the summary the case carries has the last four and source — never the encrypted number', () => {
    expect(caseSsnSummary(stored)).toEqual({ last4: '3456', source: 'arrangement_form', capturedAt: stored.capturedAt, correctedAt: null });
  });

  it('a correction needs a real reason, with no number in it', () => {
    expect(parseSsnCorrectionReason('typo on the Arrangement Form')).toBe('typo on the Arrangement Form');
    expect(parseSsnCorrectionReason('')).toEqual({ error: 'Explain why the Social Security number is being corrected.' });
    expect(parseSsnCorrectionReason('should be 000-12-3456')).toEqual({ error: 'Do not include the number in the reason.' });
  });
});

describe('the case mapper and case saves', () => {
  it('maps only the summary; the encrypted number never reaches a Case', () => {
    const item = { beaconCaseId: 'c1', organizationId: 'managed-cremations', caseNumber: 'B2026-900', decedentName: 'TEST', currentStage: 0, checklistState: {}, fieldValues: {}, ssnProtected: stored } as never;
    const case_ = mapWixCaseItem(item);
    if (case_) {
      expect(case_.ssnOnFile).toEqual({ last4: '3456', source: 'arrangement_form', capturedAt: stored.capturedAt, correctedAt: null });
      expect(JSON.stringify(case_)).not.toContain('c2VhbGVk');
    }
  });

  it('no case save can set or replace it — the field is not accepted from a patch', () => {
    const { patch } = validateAndPickCaseUpdate({ ssnProtected: stored, ssnOnFile: { last4: '9999' }, decedentName: 'X' });
    expect(patch).not.toHaveProperty('ssnProtected');
    expect(patch).not.toHaveProperty('ssnOnFile');
  });
});
