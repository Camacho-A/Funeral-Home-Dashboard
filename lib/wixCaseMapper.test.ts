import { describe, expect, it } from 'vitest';
import { mapWixCaseItem } from './wixCaseMapper';

const validItem = {
  beaconCaseId: '1042',
  organizationId: 'managed-cremations',
  caseType: 'cremation',
  workflowTemplateId: 'workflow-template-standard-cremation',
  workflowTemplateVersion: 1,
  workflowSnapshot: {
    workflowTemplateId: 'workflow-template-standard-cremation',
    workflowTemplateVersion: 1,
    stages: [{ rawStage: 0, displayStage: 0, label: 'First Call & Payment', slaTargetDays: 1, checklist: { items: [] } }],
    intake: { sections: [] },
  },
  intakeOwnerId: 'staff-dana',
  caseHandlerId: 'staff-chris',
  currentStage: 3,
  checklistState: { 0: true, 1: false },
  fieldValues: { 0: 'Robert Ellison' },
  decedentName: 'Robert Ellison',
  dateOfBirth: '03/14/1951',
  dateOfDeath: '07/09/2026',
  timeOfDeath: '06:12',
  placeOfDeath: "St. Mary's Hospital",
  weight: '178 lb',
  nextOfKinName: 'Karen Ellison',
  nextOfKinPhone: '(555) 201-4432',
  paymentStatus: 'paid_in_full',
  isVeteran: false,
  vaStepsState: {},
  vaPublishChoice: null,
  daysWaitingInStage: 6,
  isStalled: true,
  stalledReason: 'Waiting on ME release',
  createdBy: 'staff-dana',
  isArchived: false,
  createdAt: '2026-07-09T00:00:00.000Z',
  _id: 'some-random-wix-guid',
  _createdDate: '2026-07-09T00:00:00.000Z',
};

describe('mapWixCaseItem', () => {
  it('maps a well-formed item to the Case domain shape, applying the documented renames', () => {
    const result = mapWixCaseItem(validItem);

    expect(result).toMatchObject({
      id: '1042',
      organizationId: 'managed-cremations',
      rawStage: 3, // from currentStage
      assignedStaffId: 'staff-chris', // from caseHandlerId
      isDeleted: false, // from isArchived
      intakeOwnerId: 'staff-dana',
      createdBy: 'staff-dana',
    });
  });

  it('never uses the Wix system _id as the case id', () => {
    const result = mapWixCaseItem(validItem);
    expect(result?.id).toBe('1042');
    expect(result?.id).not.toBe('some-random-wix-guid');
  });

  it('passes workflowSnapshot through unchanged — no mutation, no rebuilding', () => {
    const result = mapWixCaseItem(validItem);
    expect(result?.workflowSnapshot).toEqual(validItem.workflowSnapshot);
  });

  it('allows null for optional identity fields (assignedStaffId, createdBy, intakeOwnerId, stalledReason)', () => {
    const result = mapWixCaseItem({
      ...validItem,
      caseHandlerId: null,
      createdBy: null,
      intakeOwnerId: null,
      stalledReason: null,
      isStalled: false,
    });
    expect(result?.assignedStaffId).toBeNull();
    expect(result?.createdBy).toBeNull();
    expect(result?.intakeOwnerId).toBeNull();
    expect(result?.stalledReason).toBeNull();
  });

  it('defaults optional numeric/boolean fields when absent rather than rejecting the record', () => {
    const { daysWaitingInStage, isStalled, ...withoutOptional } = validItem;
    void daysWaitingInStage;
    void isStalled;
    const result = mapWixCaseItem(withoutOptional as typeof validItem);
    expect(result?.daysWaitingInStage).toBe(0);
    expect(result?.isStalled).toBe(false);
  });

  it('returns null when the workflow snapshot is missing or malformed — excluded, not returned broken', () => {
    expect(mapWixCaseItem({ ...validItem, workflowSnapshot: null })).toBeNull();
    expect(mapWixCaseItem({ ...validItem, workflowSnapshot: { stages: 'not-an-array' } })).toBeNull();
    expect(mapWixCaseItem({ ...validItem, workflowSnapshot: undefined })).toBeNull();
  });

  it('returns null when required identity/type fields are missing or the wrong type', () => {
    expect(mapWixCaseItem(undefined)).toBeNull();
    expect(mapWixCaseItem({ ...validItem, beaconCaseId: undefined })).toBeNull();
    expect(mapWixCaseItem({ ...validItem, organizationId: 123 })).toBeNull();
    expect(mapWixCaseItem({ ...validItem, currentStage: '3' })).toBeNull();
    expect(mapWixCaseItem({ ...validItem, paymentStatus: 'refunded' })).toBeNull();
    expect(mapWixCaseItem({ ...validItem, isVeteran: 'no' })).toBeNull();
    expect(mapWixCaseItem({ ...validItem, checklistState: 'not-an-object' })).toBeNull();
  });
});
