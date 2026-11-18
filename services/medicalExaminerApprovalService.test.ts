import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { caseDocumentFixtures } from './__mocks__/documentFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import type { CaseDocument } from '../types/caseDocument';

const wix = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../lib/wixDataApi', async () => {
  const actual = await vi.importActual<object>('../lib/wixDataApi');
  const refuse = () => {
    wix.calls += 1;
    throw new Error('Wix must not be called');
  };
  return { ...actual, queryWixDataItems: refuse, queryAllWixDataItems: refuse, conditionalPatchWixDataItemFields: refuse };
});
const { recordMedicalExaminerApprovalForCase } = await import('./medicalExaminerApprovalService');
const { evaluateCremationReleaseForCaller } = await import('./cremationReleaseService');

/** ME cremation approval storage (Gus Phase 5G) — mock mode, fictional data. */
const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const ctx = (org = GUS) => ({ organizationId: org, actorIdentityId: 'identity-gus-director', actorMembershipId: null, actorRoleKey: 'funeralDirector', correlationId: 'c' });
const input = { confirmedInEdrs: true, approvalDate: '2026-12-09', reference: 'EDRS-FICTIONAL-1001', evidenceDocumentId: null, evidenceSource: 'EDRS case status screen (fictional)', actorName: 'Jordan Demo', now: '2026-12-10T15:00:00.000Z' };
const index = caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS);
const original = caseFixtures[index];

beforeEach(() => {
  caseFixtures[index] = { ...original, dateOfDeath: '12/08/2026', crematory: { permitVerification: { documentId: 'doc-permit', checksumSha256: 'fictional', verifiedBy: 'identity-gus-admin', verifiedAt: '2026-12-09T12:00:00.000Z' } } };
  activityEventFixtures.length = 0;
  caseDocumentFixtures.length = 0;
  appointmentFixtures.length = 0;
  wix.calls = 0;
});
afterEach(() => {
  caseFixtures[index] = original;
});

describe('recording the ME cremation approval', () => {
  it('is stored in the case crematory record, next to (not instead of) the permit, with history and one Activity event', async () => {
    const view = await recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-010', input, 'mock');
    expect(view.approval).toMatchObject({ reference: 'EDRS-FICTIONAL-1001', recordedBy: 'identity-gus-director', recordedAt: '2026-12-10T15:00:00.000Z' });
    const stored = caseFixtures[index].crematory!;
    expect(stored.permitVerification?.documentId).toBe('doc-permit');
    expect(stored.medicalExaminerApprovalHistory).toHaveLength(1);
    const events = activityEventFixtures.filter((e) => e.eventType === ACTIVITY_EVENT_TYPES.MEDICAL_EXAMINER_APPROVAL_RECORDED);
    expect(events).toHaveLength(1);
    expect(events[0].correlationId).toBe(view.approval!.eventId);
  });

  it('a correction needs a reason; both recordings stay in the history', async () => {
    await recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-010', input, 'mock');
    await expect(recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-010', { ...input, reference: 'EDRS-FICTIONAL-1002' }, 'mock')).rejects.toMatchObject({ status: 400 });
    const view = await recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-010', { ...input, reference: 'EDRS-FICTIONAL-1002', reason: 'Wrong reference' }, 'mock');
    expect(view.history.map((h) => h.action)).toEqual(['recorded', 'corrected']);
    expect(view.approval?.reference).toBe('EDRS-FICTIONAL-1002');
  });

  it('evidence documents must be on this case', async () => {
    caseDocumentFixtures.push({ id: 'doc-other', organizationId: GUS, caseId: 'gus-case-011', fileName: 'other.pdf', status: 'active', createdAt: '2026-12-01T00:00:00.000Z' } as CaseDocument);
    await expect(recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-010', { ...input, evidenceDocumentId: 'doc-other' }, 'mock')).rejects.toMatchObject({ status: 400 });
  });

  it('the permit alone never satisfies the ME prerequisite; a recorded approval satisfies only that one', async () => {
    const caller = { organizationId: GUS, userId: 'identity-gus-director', role: 'funeralDirector' };
    const before = (await evaluateCremationReleaseForCaller(caller, 'gus-case-010', 'mock', '2026-12-12T15:00:00.000Z'))!;
    expect(before.prerequisites.find((p) => p.key === 'state_permit')!.met).toBe(true);
    expect(before.prerequisites.find((p) => p.key === 'medical_examiner_approval')!.met).toBe(false);
    await recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-010', input, 'mock');
    const after = (await evaluateCremationReleaseForCaller(caller, 'gus-case-010', 'mock', '2026-12-12T15:00:00.000Z'))!;
    const changed = after.prerequisites.filter((p, i) => p.met !== before.prerequisites[i].met).map((p) => p.key);
    expect(changed).toEqual(['medical_examiner_approval']);
    expect(after.allPrerequisitesMet).toBe(false);
    expect(after.canRelease).toBe(false);
  });

  it('only Gus Viewing / Final Goodbye cases; never another organization; archived cases are read-only', async () => {
    await expect(recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-001', input, 'mock')).rejects.toMatchObject({ status: 404 });
    await expect(recordMedicalExaminerApprovalForCase(ctx(DEFAULT_ORGANIZATION_ID), 'gus-case-010', input, 'mock')).rejects.toMatchObject({ status: 404 });
    const manors = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!;
    await expect(recordMedicalExaminerApprovalForCase(ctx(DEFAULT_ORGANIZATION_ID), manors.id, input, 'mock')).rejects.toMatchObject({ status: 404 });
    caseFixtures[index] = { ...caseFixtures[index], isDeleted: true };
    await expect(recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-010', input, 'mock')).rejects.toMatchObject({ status: 409 });
  });

  it('never writes on a live (Wix) site yet', async () => {
    await expect(recordMedicalExaminerApprovalForCase(ctx(), 'gus-case-010', input, 'wix')).rejects.toMatchObject({ status: 503 });
    expect(wix.calls).toBe(0);
  });
});
