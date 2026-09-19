import { describe, it, expect } from 'vitest';
import { toPickupOnlyView, PICKUP_ONLY_PATCH_FIELDS } from './pickupView';
import type { Case } from '../../types/case';

const FULL_CASE: Case = {
  id: 'case-1',
  organizationId: 'org-1',
  caseNumber: 'B2026-001',
  caseType: 'cremation',
  workflowTemplateId: 'workflow-template-standard-cremation',
  workflowTemplateVersion: 1,
  workflowSnapshot: { workflowTemplateId: 'workflow-template-standard-cremation', workflowTemplateVersion: 1, stages: [], intake: { sections: [] } },
  decedentName: 'Jane Doe',
  dateOfBirth: '01/01/1950',
  dateOfDeath: '01/01/2026',
  timeOfDeath: '08:00',
  placeOfDeath: 'Test Hospital',
  weight: '150 lb',
  rawStage: 0,
  assignedStaffId: 'staff-1',
  nextOfKinName: 'John Doe',
  nextOfKinPhone: '555-0000',
  nextOfKinEmail: 'john@example.com',
  nextOfKinRelationship: 'spouse',
  nextOfKinRelationshipOther: null,
  tagNumber: 'TAG-1',
  pickupStatus: 'released',
  pickupReleasedTo: 'Funeral Home X',
  pickupReleasedAt: '2026-01-02',
  pickupNote: 'Released at noon',
  paymentStatus: 'paid_in_full',
  isVeteran: false,
  vaStepsState: {},
  vaPublishChoice: null,
  checklistState: {},
  fieldValues: {},
  daysWaitingInStage: 0,
  isStalled: false,
  stalledReason: null,
  isDeleted: false,
  createdBy: 'staff-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  intakeOwnerId: 'staff-1',
};

describe('toPickupOnlyView', () => {
  it('includes only id/organizationId/caseNumber/decedentName and the four pickup fields', () => {
    const view = toPickupOnlyView(FULL_CASE);
    expect(view).toEqual({
      id: 'case-1',
      organizationId: 'org-1',
      caseNumber: 'B2026-001',
      decedentName: 'Jane Doe',
      pickupStatus: 'released',
      pickupReleasedTo: 'Funeral Home X',
      pickupReleasedAt: '2026-01-02',
      pickupNote: 'Released at noon',
    });
  });

  it('never includes NOK, financial, or any other Case field', () => {
    const view = toPickupOnlyView(FULL_CASE) as Record<string, unknown>;
    expect(view.nextOfKinName).toBeUndefined();
    expect(view.nextOfKinEmail).toBeUndefined();
    expect(view.nextOfKinRelationship).toBeUndefined();
    expect(view.paymentStatus).toBeUndefined();
    expect(view.tagNumber).toBeUndefined();
    expect(view.assignedStaffId).toBeUndefined();
    expect(view.rawStage).toBeUndefined();
  });
});

describe('PICKUP_ONLY_PATCH_FIELDS', () => {
  it('is exactly the four pickup fields', () => {
    expect([...PICKUP_ONLY_PATCH_FIELDS].sort()).toEqual(['pickupNote', 'pickupReleasedAt', 'pickupReleasedTo', 'pickupStatus'].sort());
  });
});
