import { describe, it, expect } from 'vitest';
import { buildPortalCaseView } from './portalCaseView';
import type { Case } from '../../types/case';

const CASE: Case = {
  id: 'case-1',
  organizationId: 'org-1',
  caseNumber: 'B2026-042',
  decedentName: 'Robert Ellison',
  dateOfBirth: '04/12/1951',
  dateOfDeath: '01/02/2026',
  timeOfDeath: '',
  placeOfDeath: '',
  weight: '178 lb',
  rawStage: 2,
  assignedStaffId: 'staff-1',
  nextOfKinName: 'Margaret Ellison',
  nextOfKinPhone: '(555) 010-1234',
  paymentStatus: 'awaiting_payment',
  isVeteran: false,
  vaStepsState: {},
  vaPublishChoice: null,
  checklistState: {},
  fieldValues: {},
  daysWaitingInStage: 3,
  isStalled: false,
  stalledReason: null,
  createdBy: 'identity-1',
  intakeOwnerId: 'identity-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  isDeleted: false,
  workflowTemplateId: 'wf-1',
  workflowTemplateVersion: 1,
  caseType: 'cremation',
  workflowSnapshot: null,
};

describe('buildPortalCaseView', () => {
  it('exposes only family-safe summary fields', () => {
    const view = buildPortalCaseView(CASE);
    expect(view).toEqual({
      id: 'case-1',
      caseNumber: 'B2026-042',
      decedentName: 'Robert Ellison',
      dateOfBirth: '04/12/1951',
      dateOfDeath: '01/02/2026',
      stageLabel: 'Jotform Application',
      caseType: 'cremation',
    });
  });

  it('never includes internal/operational fields', () => {
    const view = buildPortalCaseView(CASE);
    const keys = Object.keys(view);
    for (const forbidden of [
      'assignedStaffId',
      'rawStage',
      'checklistState',
      'fieldValues',
      'vaStepsState',
      'vaPublishChoice',
      'createdBy',
      'intakeOwnerId',
      'isStalled',
      'stalledReason',
      'daysWaitingInStage',
      'workflowSnapshot',
      'workflowTemplateId',
      'paymentStatus',
      'nextOfKinName',
      'nextOfKinPhone',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('derives stageLabel from rawStage rather than exposing the raw number', () => {
    const firstCallCase = buildPortalCaseView({ ...CASE, rawStage: 0 });
    expect(firstCallCase.stageLabel).toBe('First Call & Payment');

    const completedCase = buildPortalCaseView({ ...CASE, rawStage: 7 });
    expect(completedCase.stageLabel).toBe('Completed');
  });
});
