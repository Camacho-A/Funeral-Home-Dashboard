import { describe, expect, it } from 'vitest';
import {
  mapWixCaseItem,
  buildWixCaseData,
  validateAndPickCaseUpdate,
  applyCaseUpdateToWixData,
} from './wixCaseMapper';

const validItem = {
  beaconCaseId: '1042',
  organizationId: 'managed-cremations',
  caseNumber: 'B2026-001',
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

  it('returns null when caseNumber is missing or the wrong type', () => {
    expect(mapWixCaseItem({ ...validItem, caseNumber: undefined })).toBeNull();
    expect(mapWixCaseItem({ ...validItem, caseNumber: 2026 })).toBeNull();
  });

  it('maps caseNumber through unchanged (no reformatting at the mapper boundary)', () => {
    const result = mapWixCaseItem(validItem);
    expect(result?.caseNumber).toBe('B2026-001');
  });
});

describe('buildWixCaseData', () => {
  const params = {
    beaconCaseId: 'new-case-1',
    organizationId: 'managed-cremations',
    caseNumber: 'B2026-001',
    caseType: 'cremation',
    workflowTemplateId: 'workflow-template-standard-cremation',
    workflowTemplateVersion: 1,
    workflowSnapshot: validItem.workflowSnapshot,
    intakeOwnerId: 'staff-dana',
    createdBy: 'staff-dana',
    assignedStaffId: 'staff-dana',
    decedentName: 'New Decedent',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '07/20/2026',
    timeOfDeath: '10:00',
    placeOfDeath: 'Test Hospital',
    weight: '160 lb',
    nextOfKinName: 'NOK',
    nextOfKinPhone: '555-0000',
    fieldValues: {},
    createdAt: '2026-07-23T00:00:00.000Z',
  };

  it('builds a complete Wix cases item, round-trippable through mapWixCaseItem', () => {
    const data = buildWixCaseData(params);
    const mapped = mapWixCaseItem(data);

    expect(mapped).not.toBeNull();
    expect(mapped?.id).toBe('new-case-1');
    expect(mapped?.organizationId).toBe('managed-cremations');
    expect(mapped?.assignedStaffId).toBe('staff-dana');
    expect(mapped?.rawStage).toBe(0);
    expect(mapped?.isDeleted).toBe(false);
    expect(mapped?.paymentStatus).toBe('awaiting_payment');
  });

  it('defaults a new case to stage 0, an empty checklist, and not archived', () => {
    const data = buildWixCaseData(params);
    expect(data.currentStage).toBe(0);
    expect(data.checklistState).toEqual({});
    expect(data.isArchived).toBe(false);
  });
});

describe('validateAndPickCaseUpdate', () => {
  it('picks only known, correctly-typed fields', () => {
    const { patch, errors } = validateAndPickCaseUpdate({
      decedentName: 'Renamed',
      isVeteran: true,
      checklistState: { 0: true },
    });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ decedentName: 'Renamed', isVeteran: true, checklistState: { 0: true } });
  });

  it('silently drops immutable/unknown fields even when present in the body', () => {
    const { patch, errors } = validateAndPickCaseUpdate({
      decedentName: 'Renamed',
      organizationId: 'evergreen-memorial-group',
      workflowTemplateId: 'forged-template',
      workflowTemplateVersion: 99,
      workflowSnapshot: { stages: [] },
      intakeOwnerId: 'staff-someone-else',
      createdBy: 'staff-someone-else',
      createdAt: '2000-01-01T00:00:00.000Z',
      id: 'forged-id',
      caseNumber: 'B2026-999',
    });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ decedentName: 'Renamed' });
    expect(patch).not.toHaveProperty('caseNumber');
  });

  it('rejects a present-but-wrong-typed field rather than silently dropping or coercing it', () => {
    const { patch, errors } = validateAndPickCaseUpdate({ rawStage: 'not-a-number', isVeteran: 'yes' });
    expect(errors).toContain('rawStage');
    expect(errors).toContain('isVeteran');
    expect(patch).toEqual({});
  });

  it('validates the paymentStatus and vaPublishChoice enums', () => {
    expect(validateAndPickCaseUpdate({ paymentStatus: 'refunded' }).errors).toContain('paymentStatus');
    expect(validateAndPickCaseUpdate({ paymentStatus: 'paid_in_full' }).patch.paymentStatus).toBe('paid_in_full');
    expect(validateAndPickCaseUpdate({ vaPublishChoice: 'invalid' }).errors).toContain('vaPublishChoice');
    expect(validateAndPickCaseUpdate({ vaPublishChoice: null }).patch.vaPublishChoice).toBeNull();
  });

  it('allows assignedStaffId and stalledReason to be null', () => {
    const { patch, errors } = validateAndPickCaseUpdate({ assignedStaffId: null, stalledReason: null });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ assignedStaffId: null, stalledReason: null });
  });

  it('returns an error for a non-object body', () => {
    expect(validateAndPickCaseUpdate(null).errors.length).toBeGreaterThan(0);
    expect(validateAndPickCaseUpdate('a string').errors.length).toBeGreaterThan(0);
  });
});

describe('applyCaseUpdateToWixData', () => {
  it('merges a patch onto the existing data, preserving every untouched field', () => {
    const existing = { ...validItem };
    const result = applyCaseUpdateToWixData(existing, { decedentName: 'Renamed' });

    expect(result.decedentName).toBe('Renamed');
    expect(result.organizationId).toBe(existing.organizationId);
    expect(result.workflowSnapshot).toBe(existing.workflowSnapshot);
    expect(result.nextOfKinName).toBe(existing.nextOfKinName);
  });

  it('renames Beacon field names to their Wix collection equivalents', () => {
    const existing = { ...validItem };
    const result = applyCaseUpdateToWixData(existing, {
      assignedStaffId: 'staff-new',
      rawStage: 5,
      isDeleted: true,
    });

    expect(result.caseHandlerId).toBe('staff-new');
    expect(result.currentStage).toBe(5);
    expect(result.isArchived).toBe(true);
  });

  it('does not mutate the original existing object', () => {
    const existing = { ...validItem };
    applyCaseUpdateToWixData(existing, { decedentName: 'Renamed' });
    expect(existing.decedentName).toBe(validItem.decedentName);
  });
});
