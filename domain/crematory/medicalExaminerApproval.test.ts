import { describe, expect, it } from 'vitest';
import { checkMedicalExaminerApproval, MedicalExaminerApprovalError, recordMedicalExaminerApproval, type MedicalExaminerApprovalInput } from './medicalExaminerApproval';

/** ME cremation approval (Gus Phase 5G). Fictional references only. */
const NOW = '2026-12-10T15:00:00.000Z';
const actor = { id: 'identity-gus-director', name: 'Jordan Demo' };
const input = (overrides: Partial<MedicalExaminerApprovalInput> = {}): MedicalExaminerApprovalInput => ({
  confirmedInEdrs: true,
  approvalDate: '2026-12-09',
  reference: 'EDRS-FICTIONAL-1001',
  evidenceDocumentId: null,
  evidenceSource: 'EDRS case status screen (fictional)',
  ...overrides,
});
const record = (i: MedicalExaminerApprovalInput, current: ReturnType<typeof recordMedicalExaminerApproval>['approval'] | null = null) =>
  recordMedicalExaminerApproval({ input: i, current, dateOfDeath: '12/08/2026', actor, now: NOW, eventId: 'evt-1' });

describe('medical examiner cremation approval', () => {
  it('records who, when (server time), the date, reference and evidence', () => {
    const { approval, entry } = record(input());
    expect(approval).toMatchObject({ confirmedInEdrs: true, approvalDate: '2026-12-09', reference: 'EDRS-FICTIONAL-1001', recordedBy: actor.id, recordedByName: 'Jordan Demo', recordedAt: NOW, eventId: 'evt-1' });
    expect(entry).toMatchObject({ action: 'recorded', previous: null, reason: null });
    expect(checkMedicalExaminerApproval(approval, { dateOfDeath: '12/08/2026', today: '2026-12-10' }).valid).toBe(true);
  });

  it('refuses anything incomplete or implausible', () => {
    expect(() => record(input({ confirmedInEdrs: false }))).toThrow(/EDRS/);
    expect(() => record(input({ reference: ' ' }))).toThrow(/reference/);
    expect(() => record(input({ evidenceSource: null }))).toThrow(/evidence/);
    expect(() => record(input({ approvalDate: '2026-12-31' }))).toThrow(/future/);
    expect(() => record(input({ approvalDate: '2026-12-01' }))).toThrow(/before the date of death/);
    expect(() => record(input({ approvalDate: '2026-02-30' }))).toThrow(/invalid/);
    expect(() => record(input({ evidenceSource: null, evidenceDocumentId: 'doc-1' }))).not.toThrow();
  });

  it('a correction needs a reason and keeps the earlier approval in the history entry', () => {
    const first = record(input()).approval;
    expect(() => record(input({ reference: 'EDRS-FICTIONAL-1002' }), first)).toThrow(MedicalExaminerApprovalError);
    const corrected = record(input({ reference: 'EDRS-FICTIONAL-1002', reason: 'Typo in reference' }), first);
    expect(corrected.entry).toMatchObject({ action: 'corrected', reason: 'Typo in reference', previous: first });
  });

  it('nothing counts as an approval except a recorded one', () => {
    expect(checkMedicalExaminerApproval(null, { dateOfDeath: '12/08/2026', today: '2026-12-10' })).toEqual({ valid: false, problems: ['No medical examiner cremation approval has been recorded.'] });
  });
});
