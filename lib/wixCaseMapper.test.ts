import { describe, expect, it } from 'vitest';
import {
  mapWixCaseItem,
  buildWixCaseData,
  validateAndPickCaseUpdate,
  applyCaseUpdateToWixData,
  describeMapWixCaseItemFailure,
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

  it('maps nextOfKinEmail to null for a pre-existing row that has no such field at all (Manors launch-prep)', () => {
    // validItem itself has no nextOfKinEmail key — the exact shape of every
    // case created before this field existed.
    const result = mapWixCaseItem(validItem);
    expect(result?.nextOfKinEmail).toBeNull();
  });

  it('maps a real nextOfKinEmail value through unchanged', () => {
    const result = mapWixCaseItem({ ...validItem, nextOfKinEmail: 'karen@example.com' });
    expect(result?.nextOfKinEmail).toBe('karen@example.com');
  });

  it('maps nextOfKinRelationship to null for a pre-existing row with no such field (Manors launch-prep)', () => {
    const result = mapWixCaseItem(validItem);
    expect(result?.nextOfKinRelationship).toBeNull();
    expect(result?.nextOfKinRelationshipOther).toBeNull();
  });

  it('maps a valid nextOfKinRelationship value through unchanged', () => {
    const result = mapWixCaseItem({ ...validItem, nextOfKinRelationship: 'daughter' });
    expect(result?.nextOfKinRelationship).toBe('daughter');
  });

  it('maps an unrecognized nextOfKinRelationship value to null rather than trusting it', () => {
    const result = mapWixCaseItem({ ...validItem, nextOfKinRelationship: 'cousin-twice-removed' });
    expect(result?.nextOfKinRelationship).toBeNull();
  });

  it('maps nextOfKinRelationshipOther through unchanged', () => {
    const result = mapWixCaseItem({ ...validItem, nextOfKinRelationship: 'other', nextOfKinRelationshipOther: 'family friend' });
    expect(result?.nextOfKinRelationshipOther).toBe('family friend');
  });

  it('10. maps every certifier field to null for a pre-existing row that has no such fields at all (frozen at v1-v4, ADR-041)', () => {
    const result = mapWixCaseItem(validItem);
    expect(result?.certifierName).toBeNull();
    expect(result?.certifierPhone).toBeNull();
    expect(result?.certifierLicenseNumber).toBeNull();
    expect(result?.certifierFax).toBeNull();
  });

  it('11. maps real certifier field values through unchanged', () => {
    const result = mapWixCaseItem({
      ...validItem,
      certifierName: 'Dr. Jane Foster',
      certifierPhone: '555-0199',
      certifierLicenseNumber: 'MD-4471',
      certifierFax: '555-0188',
    });
    expect(result?.certifierName).toBe('Dr. Jane Foster');
    expect(result?.certifierPhone).toBe('555-0199');
    expect(result?.certifierLicenseNumber).toBe('MD-4471');
    expect(result?.certifierFax).toBe('555-0188');
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

describe('mapWixCaseItem — conditional shipping/tracking (2026-09)', () => {
  it('maps returnMethod to "undecided" for a pre-existing row with no such field at all — never "pickup"', () => {
    // validItem itself has no returnMethod key — the exact shape of every
    // case created before this field existed.
    const result = mapWixCaseItem(validItem);
    expect(result?.returnMethod).toBe('undecided');
  });

  it('maps a real returnMethod value through unchanged', () => {
    expect(mapWixCaseItem({ ...validItem, returnMethod: 'pickup' })?.returnMethod).toBe('pickup');
    expect(mapWixCaseItem({ ...validItem, returnMethod: 'shipping' })?.returnMethod).toBe('shipping');
  });

  it('maps an unrecognized returnMethod value to "undecided" rather than trusting it', () => {
    const result = mapWixCaseItem({ ...validItem, returnMethod: 'mailed-somehow' });
    expect(result?.returnMethod).toBe('undecided');
  });

  it('maps all five shipping detail fields to null for a pre-existing row with none of them', () => {
    const result = mapWixCaseItem(validItem);
    expect(result?.shippingCarrier).toBeNull();
    expect(result?.shippingTrackingNumber).toBeNull();
    expect(result?.shippingDateShipped).toBeNull();
    expect(result?.shippingDeliveryStatus).toBeNull();
    expect(result?.shippingDeliveredAt).toBeNull();
  });

  it('maps real shipping detail values through unchanged', () => {
    const result = mapWixCaseItem({
      ...validItem,
      returnMethod: 'shipping',
      shippingCarrier: 'USPS',
      shippingTrackingNumber: '9400111899223197428019',
      shippingDateShipped: '07/15/2026',
      shippingDeliveryStatus: 'delivered',
      shippingDeliveredAt: '07/18/2026',
    });
    expect(result?.shippingCarrier).toBe('USPS');
    expect(result?.shippingTrackingNumber).toBe('9400111899223197428019');
    expect(result?.shippingDateShipped).toBe('07/15/2026');
    expect(result?.shippingDeliveryStatus).toBe('delivered');
    expect(result?.shippingDeliveredAt).toBe('07/18/2026');
  });

  it('maps an unrecognized shippingDeliveryStatus value to null rather than trusting it', () => {
    const result = mapWixCaseItem({ ...validItem, shippingDeliveryStatus: 'in-transit' });
    expect(result?.shippingDeliveryStatus).toBeNull();
  });
});

describe('describeMapWixCaseItemFailure (Solis go-live diagnostics)', () => {
  it('returns an empty array for a well-formed item (mirrors mapWixCaseItem accepting it)', () => {
    expect(describeMapWixCaseItemFailure(validItem)).toEqual([]);
  });

  it('reports a single, specific failure for one bad field', () => {
    const failures = describeMapWixCaseItemFailure({ ...validItem, currentStage: '3' });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/currentStage/);
    expect(failures[0]).toMatch(/expected number, got string/);
  });

  it('reports every failing field, not just the first, unlike mapWixCaseItem\'s fail-fast null', () => {
    const failures = describeMapWixCaseItemFailure({
      ...validItem,
      organizationId: 123,
      isVeteran: 'no',
      checklistState: 'not-an-object',
    });
    expect(failures.length).toBe(3);
    expect(failures.some((f) => f.includes('organizationId'))).toBe(true);
    expect(failures.some((f) => f.includes('isVeteran'))).toBe(true);
    expect(failures.some((f) => f.includes('checklistState'))).toBe(true);
  });

  it('reports a missing/undefined item distinctly rather than throwing', () => {
    expect(describeMapWixCaseItemFailure(undefined)).toEqual(['item is missing/undefined']);
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

  it('defaults nextOfKinEmail to null when not provided at all (Manors launch-prep)', () => {
    const data = buildWixCaseData(params);
    expect(mapWixCaseItem(data)?.nextOfKinEmail).toBeNull();
  });

  it('carries an explicitly-provided nextOfKinEmail through to the built item', () => {
    const data = buildWixCaseData({ ...params, nextOfKinEmail: 'karen@example.com' });
    expect(mapWixCaseItem(data)?.nextOfKinEmail).toBe('karen@example.com');
  });

  it('conditional shipping/tracking (2026-09): defaults a new case to returnMethod "undecided" when not provided — never "pickup"', () => {
    const data = buildWixCaseData(params);
    expect(mapWixCaseItem(data)?.returnMethod).toBe('undecided');
  });

  it('carries an explicitly-provided returnMethod through to the built item, with no shipping detail fields ever required at creation', () => {
    const data = buildWixCaseData({ ...params, returnMethod: 'shipping' });
    const mapped = mapWixCaseItem(data);
    expect(mapped?.returnMethod).toBe('shipping');
    expect(mapped?.shippingCarrier).toBeNull();
    expect(mapped?.shippingTrackingNumber).toBeNull();
  });

  it('12. defaults every certifier field to null when not provided at all (2026-09, ADR-041)', () => {
    const data = buildWixCaseData(params);
    const mapped = mapWixCaseItem(data);
    expect(mapped?.certifierName).toBeNull();
    expect(mapped?.certifierPhone).toBeNull();
    expect(mapped?.certifierLicenseNumber).toBeNull();
    expect(mapped?.certifierFax).toBeNull();
  });

  it('13. carries explicitly-provided certifier fields through to the built item, round-trippable through mapWixCaseItem', () => {
    const data = buildWixCaseData({
      ...params,
      certifierName: 'Dr. Jane Foster',
      certifierPhone: '555-0199',
      certifierLicenseNumber: 'MD-4471',
      certifierFax: '555-0188',
    });
    const mapped = mapWixCaseItem(data);
    // ALL-CAPS: certifierName/certifierLicenseNumber are normalized on the
    // way in (buildWixCaseData), same as decedentName/tagNumber; phone/fax
    // are excluded, matching nextOfKinPhone's own unmasked convention.
    expect(mapped?.certifierName).toBe('DR. JANE FOSTER');
    expect(mapped?.certifierPhone).toBe('555-0199');
    expect(mapped?.certifierLicenseNumber).toBe('MD-4471');
    expect(mapped?.certifierFax).toBe('555-0188');
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
    // SOLIS ALL-CAPS data standard (2026-09): decedentName is normalized
    // before the patch is ever returned — see the dedicated describe block
    // below for exhaustive normalization coverage.
    expect(patch).toEqual({ decedentName: 'RENAMED', isVeteran: true, checklistState: { 0: true } });
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
    expect(patch).toEqual({ decedentName: 'RENAMED' });
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

describe('validateAndPickCaseUpdate — conditional shipping/tracking (2026-09)', () => {
  it('accepts a valid returnMethod value', () => {
    expect(validateAndPickCaseUpdate({ returnMethod: 'shipping' }).patch.returnMethod).toBe('shipping');
    expect(validateAndPickCaseUpdate({ returnMethod: 'pickup' }).patch.returnMethod).toBe('pickup');
    expect(validateAndPickCaseUpdate({ returnMethod: 'undecided' }).patch.returnMethod).toBe('undecided');
  });

  it('rejects an unrecognized returnMethod value rather than silently dropping or coercing it', () => {
    const { patch, errors } = validateAndPickCaseUpdate({ returnMethod: 'carrier-pigeon' });
    expect(errors).toContain('returnMethod');
    expect(patch).toEqual({});
  });

  it('accepts and nullably clears the five shipping detail fields', () => {
    const { patch, errors } = validateAndPickCaseUpdate({
      shippingCarrier: 'USPS',
      shippingTrackingNumber: '9400111899223197428019',
      shippingDateShipped: '07/15/2026',
      shippingDeliveryStatus: 'delivered',
      shippingDeliveredAt: '07/18/2026',
    });
    expect(errors).toEqual([]);
    expect(patch).toEqual({
      shippingCarrier: 'USPS',
      shippingTrackingNumber: '9400111899223197428019',
      shippingDateShipped: '07/15/2026',
      shippingDeliveryStatus: 'delivered',
      shippingDeliveredAt: '07/18/2026',
    });

    const cleared = validateAndPickCaseUpdate({ shippingCarrier: null, shippingDeliveryStatus: null });
    expect(cleared.errors).toEqual([]);
    expect(cleared.patch.shippingCarrier).toBeNull();
    expect(cleared.patch.shippingDeliveryStatus).toBeNull();
  });

  it('rejects an unrecognized shippingDeliveryStatus value', () => {
    const { patch, errors } = validateAndPickCaseUpdate({ shippingDeliveryStatus: 'in-transit' });
    expect(errors).toContain('shippingDeliveryStatus');
    expect(patch).toEqual({});
  });
});

describe('validateAndPickCaseUpdate — nextOfKinEmail (Manors launch-prep)', () => {
  it('accepts a well-formed email', () => {
    const { patch, errors } = validateAndPickCaseUpdate({ nextOfKinEmail: 'karen@example.com' });
    expect(errors).toEqual([]);
    expect(patch.nextOfKinEmail).toBe('karen@example.com');
  });

  it('trims surrounding whitespace before validating and persisting', () => {
    const { patch, errors } = validateAndPickCaseUpdate({ nextOfKinEmail: '  karen@example.com  ' });
    expect(errors).toEqual([]);
    expect(patch.nextOfKinEmail).toBe('karen@example.com');
  });

  it('treats an empty (or whitespace-only) string as clearing to null, not a validation error', () => {
    expect(validateAndPickCaseUpdate({ nextOfKinEmail: '' }).patch.nextOfKinEmail).toBeNull();
    expect(validateAndPickCaseUpdate({ nextOfKinEmail: '   ' }).patch.nextOfKinEmail).toBeNull();
  });

  it('accepts an explicit null to clear an existing email', () => {
    const { patch, errors } = validateAndPickCaseUpdate({ nextOfKinEmail: null });
    expect(errors).toEqual([]);
    expect(patch.nextOfKinEmail).toBeNull();
  });

  it('rejects a malformed email rather than silently dropping or coercing it', () => {
    const { patch, errors } = validateAndPickCaseUpdate({ nextOfKinEmail: 'not-an-email' });
    expect(errors).toContain('nextOfKinEmail');
    expect(patch).toEqual({});
  });

  it('rejects a non-string, non-null value', () => {
    const { errors } = validateAndPickCaseUpdate({ nextOfKinEmail: 12345 });
    expect(errors).toContain('nextOfKinEmail');
  });
});

describe('validateAndPickCaseUpdate — Certifier fields (2026-09, ADR-041)', () => {
  it('14. accepts and picks all four certifier fields', () => {
    const { patch, errors } = validateAndPickCaseUpdate({
      certifierName: 'Dr. Jane Foster',
      certifierPhone: '555-0199',
      certifierLicenseNumber: 'MD-4471',
      certifierFax: '555-0188',
    });
    expect(errors).toEqual([]);
    expect(patch.certifierPhone).toBe('555-0199');
    expect(patch.certifierLicenseNumber).toBe('MD-4471');
    expect(patch.certifierFax).toBe('555-0188');
    // ALL-CAPS: certifierName is a name field, normalized like decedentName.
    expect(patch.certifierName).toBe('DR. JANE FOSTER');
  });

  it('15. accepts an explicit null on each certifier field, to clear it', () => {
    const { patch, errors } = validateAndPickCaseUpdate({
      certifierName: null,
      certifierPhone: null,
      certifierLicenseNumber: null,
      certifierFax: null,
    });
    expect(errors).toEqual([]);
    expect(patch).toEqual({
      certifierName: null,
      certifierPhone: null,
      certifierLicenseNumber: null,
      certifierFax: null,
    });
  });

  it('16. rejects a non-string, non-null value for any certifier field', () => {
    expect(validateAndPickCaseUpdate({ certifierName: 12345 }).errors).toContain('certifierName');
    expect(validateAndPickCaseUpdate({ certifierPhone: 12345 }).errors).toContain('certifierPhone');
    expect(validateAndPickCaseUpdate({ certifierLicenseNumber: 12345 }).errors).toContain('certifierLicenseNumber');
    expect(validateAndPickCaseUpdate({ certifierFax: 12345 }).errors).toContain('certifierFax');
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

  it('conditional shipping/tracking (2026-09): applies returnMethod and shipping fields onto the existing data', () => {
    const existing = { ...validItem, returnMethod: 'undecided' };
    const result = applyCaseUpdateToWixData(existing, {
      returnMethod: 'shipping',
      shippingCarrier: 'USPS',
      shippingTrackingNumber: '9400111899223197428019',
    });
    expect(result.returnMethod).toBe('shipping');
    expect(result.shippingCarrier).toBe('USPS');
    expect(result.shippingTrackingNumber).toBe('9400111899223197428019');
  });

  it('a returnMethod change never touches the pickup or the other shipping fields already on the record', () => {
    const existing = { ...validItem, returnMethod: 'pickup', pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison' };
    const result = applyCaseUpdateToWixData(existing, { returnMethod: 'shipping' });
    expect(result.returnMethod).toBe('shipping');
    expect(result.pickupStatus).toBe('released');
    expect(result.pickupReleasedTo).toBe('Karen Ellison');
  });

  /**
   * Case field editing / field-backed checklist sync (2026-09). A combined
   * {weight, fieldValues} patch (hooks/useCaseMutations.ts#setWeight's own
   * shape) is exactly the class of update the B2026-034 incident showed
   * can go wrong if a caller ever sends Wix a bare partial object instead
   * of routing through this merge function — this proves the full record
   * survives a real combined-field save, not just a single-field one.
   */
  it('a combined weight+fieldValues patch preserves every other field on the record (Wix full-replace safety)', () => {
    const existing = { ...validItem, fieldValues: { 0: 'Robert Ellison', 1: "St. Mary's Hospital" } };
    const result = applyCaseUpdateToWixData(existing, { weight: '210 lb', fieldValues: { 0: 'Robert Ellison', 1: "St. Mary's Hospital", 3: '210 lb' } });

    expect(result.weight).toBe('210 lb');
    expect(result.fieldValues).toEqual({ 0: 'Robert Ellison', 1: "St. Mary's Hospital", 3: '210 lb' });
    // Every other field from the existing record survives untouched —
    // never silently dropped the way a bare partial-object PUT would.
    expect(result.organizationId).toBe(existing.organizationId);
    expect(result.caseNumber).toBe(existing.caseNumber);
    expect(result.decedentName).toBe(existing.decedentName);
    expect(result.nextOfKinName).toBe(existing.nextOfKinName);
    expect(result.nextOfKinPhone).toBe(existing.nextOfKinPhone);
    expect(result.paymentStatus).toBe(existing.paymentStatus);
    expect(result.isVeteran).toBe(existing.isVeteran);
    expect(result.checklistState).toEqual(existing.checklistState);
    expect(result.currentStage).toBe(existing.currentStage);
    expect(result.workflowSnapshot).toBe(existing.workflowSnapshot);
    expect(result.workflowTemplateId).toBe(existing.workflowTemplateId);
    expect(result.createdAt).toBe(existing.createdAt);
    expect(result.createdBy).toBe(existing.createdBy);
  });

  /** Time of Death (2026-09) — same combined-field shape as Weight's own
      test above (hooks/useCaseMutations.ts#setTimeOfDeath's patch),
      proving the Wix full-replace safety generalizes to a second field
      without any change to this merge function. */
  it('a combined timeOfDeath+fieldValues patch preserves every other field on the record (Wix full-replace safety)', () => {
    const existing = { ...validItem, fieldValues: { 0: 'Robert Ellison', 3: '178 lb' } };
    const result = applyCaseUpdateToWixData(existing, { timeOfDeath: '15:45', fieldValues: { 0: 'Robert Ellison', 3: '178 lb', 5: '15:45' } });

    expect(result.timeOfDeath).toBe('15:45');
    expect(result.fieldValues).toEqual({ 0: 'Robert Ellison', 3: '178 lb', 5: '15:45' });
    expect(result.organizationId).toBe(existing.organizationId);
    expect(result.caseNumber).toBe(existing.caseNumber);
    expect(result.decedentName).toBe(existing.decedentName);
    expect(result.weight).toBe(existing.weight);
    expect(result.nextOfKinName).toBe(existing.nextOfKinName);
    expect(result.paymentStatus).toBe(existing.paymentStatus);
    expect(result.checklistState).toEqual(existing.checklistState);
    expect(result.currentStage).toBe(existing.currentStage);
    expect(result.workflowSnapshot).toBe(existing.workflowSnapshot);
    expect(result.createdAt).toBe(existing.createdAt);
    expect(result.createdBy).toBe(existing.createdBy);
  });

  it('17. a certifier-field patch preserves every other field on the record (Wix full-replace safety)', () => {
    const existing = { ...validItem };
    const result = applyCaseUpdateToWixData(existing, {
      certifierName: 'DR. JANE FOSTER',
      certifierPhone: '555-0199',
      certifierLicenseNumber: 'MD-4471',
      certifierFax: '555-0188',
    });

    expect(result.certifierName).toBe('DR. JANE FOSTER');
    expect(result.certifierPhone).toBe('555-0199');
    expect(result.certifierLicenseNumber).toBe('MD-4471');
    expect(result.certifierFax).toBe('555-0188');
    expect(result.organizationId).toBe(existing.organizationId);
    expect(result.decedentName).toBe(existing.decedentName);
    expect(result.nextOfKinName).toBe(existing.nextOfKinName);
    expect(result.fieldValues).toEqual(existing.fieldValues);
    expect(result.workflowSnapshot).toBe(existing.workflowSnapshot);
  });

  it('18. a certifier field can be cleared back to null without touching the other three', () => {
    const existing = { ...validItem, certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199', certifierLicenseNumber: 'MD-4471', certifierFax: '555-0188' };
    const result = applyCaseUpdateToWixData(existing, { certifierFax: null });
    expect(result.certifierFax).toBeNull();
    expect(result.certifierName).toBe('DR. JANE FOSTER');
    expect(result.certifierPhone).toBe('555-0199');
    expect(result.certifierLicenseNumber).toBe('MD-4471');
  });
});

describe('SOLIS ALL-CAPS data standard (2026-09)', () => {
  const createParams = {
    beaconCaseId: 'new-case-2',
    organizationId: 'managed-cremations',
    caseNumber: 'B2026-002',
    caseType: 'cremation',
    workflowTemplateId: 'workflow-template-standard-cremation',
    workflowTemplateVersion: 1,
    workflowSnapshot: validItem.workflowSnapshot,
    intakeOwnerId: 'staff-dana',
    createdBy: 'staff-dana',
    assignedStaffId: 'staff-dana',
    decedentName: 'john michael smith',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '07/20/2026',
    timeOfDeath: '10:00',
    placeOfDeath: 'broward health medical center',
    weight: '160 lb',
    nextOfKinName: 'jane smith',
    nextOfKinPhone: '555-0000',
    nextOfKinRelationshipOther: 'family friend',
    fieldValues: {},
    createdAt: '2026-07-23T00:00:00.000Z',
  };

  it('buildWixCaseData uppercases every allowlisted field on creation, leaving excluded fields untouched', () => {
    const data = buildWixCaseData(createParams);
    expect(data.decedentName).toBe('JOHN MICHAEL SMITH');
    expect(data.placeOfDeath).toBe('BROWARD HEALTH MEDICAL CENTER');
    expect(data.nextOfKinName).toBe('JANE SMITH');
    expect(data.nextOfKinRelationshipOther).toBe('FAMILY FRIEND');
    // Excluded: dates/times/phone/weight/enums untouched.
    expect(data.dateOfBirth).toBe('01/01/1950');
    expect(data.dateOfDeath).toBe('07/20/2026');
    expect(data.timeOfDeath).toBe('10:00');
    expect(data.nextOfKinPhone).toBe('555-0000');
    expect(data.weight).toBe('160 lb');
    expect(data.paymentStatus).toBe('awaiting_payment');
    expect(data.pickupStatus).toBe('awaiting_pickup');
  });

  it('POST /api/cases cannot bypass normalization — a raw lowercase body still persists uppercase via buildWixCaseData', () => {
    // Simulates a direct API caller bypassing the New Case UI entirely —
    // app/api/cases/route.ts's POST handler passes body fields straight
    // into buildWixCaseData with no normalization of its own.
    const data = buildWixCaseData({ ...createParams, decedentName: 'forged lowercase name' });
    expect(data.decedentName).toBe('FORGED LOWERCASE NAME');
  });

  it('validateAndPickCaseUpdate uppercases allowlisted fields and leaves enum/id/date fields untouched', () => {
    const { patch, errors } = validateAndPickCaseUpdate({
      decedentName: 'jane doe',
      placeOfDeath: 'city general hospital',
      pickupReleasedTo: 'robert ellison',
      shippingCarrier: 'ups',
      pickupNote: 'family will pick up friday afternoon.',
      stalledReason: 'awaiting documents',
      nextOfKinEmail: 'Jane.Doe@Example.com',
      paymentStatus: 'paid_in_full',
      returnMethod: 'pickup',
      dateOfBirth: '01/01/1950',
    });
    expect(errors).toEqual([]);
    expect(patch.decedentName).toBe('JANE DOE');
    expect(patch.placeOfDeath).toBe('CITY GENERAL HOSPITAL');
    expect(patch.pickupReleasedTo).toBe('ROBERT ELLISON');
    expect(patch.shippingCarrier).toBe('UPS');
    expect(patch.pickupNote).toBe('FAMILY WILL PICK UP FRIDAY AFTERNOON.');
    expect(patch.stalledReason).toBe('AWAITING DOCUMENTS');
    // Excluded: email, enum literals, dates.
    expect(patch.nextOfKinEmail).toBe('Jane.Doe@Example.com');
    expect(patch.paymentStatus).toBe('paid_in_full');
    expect(patch.returnMethod).toBe('pickup');
    expect(patch.dateOfBirth).toBe('01/01/1950');
  });

  it('PATCH /api/cases/[caseId] cannot bypass normalization — a raw lowercase patch still persists uppercase via validateAndPickCaseUpdate', () => {
    const { patch } = validateAndPickCaseUpdate({ nextOfKinName: 'forged lowercase name' });
    expect(patch.nextOfKinName).toBe('FORGED LOWERCASE NAME');
  });

  it('19. certifierName/certifierLicenseNumber are uppercased; certifierPhone/certifierFax are excluded (2026-09, ADR-041)', () => {
    const { patch } = validateAndPickCaseUpdate({
      certifierName: 'dr. jane foster',
      certifierLicenseNumber: 'md-4471',
      certifierPhone: '555-0199',
      certifierFax: '555-0188',
    });
    expect(patch.certifierName).toBe('DR. JANE FOSTER');
    expect(patch.certifierLicenseNumber).toBe('MD-4471');
    expect(patch.certifierPhone).toBe('555-0199');
    expect(patch.certifierFax).toBe('555-0188');
  });

  it('is idempotent — an already-uppercase patch is unchanged', () => {
    const { patch } = validateAndPickCaseUpdate({ decedentName: 'JANE DOE' });
    expect(patch.decedentName).toBe('JANE DOE');
  });

  it('applyCaseUpdateToWixData normalizes fieldValues only for keys the case\'s own workflowSnapshot flags uppercase', () => {
    const snapshotWithUppercaseField = {
      workflowTemplateId: 'wf-1',
      workflowTemplateVersion: 1,
      stages: [],
      intake: {
        sections: [
          {
            key: 'section',
            label: 'Section',
            fields: [
              { key: 'hospice-contact', label: 'Hospice contact', checklistItemIndex: 0, uppercase: true },
              { key: 'notes', label: 'Notes', checklistItemIndex: 1, uppercase: false },
            ],
          },
        ],
      },
    };
    const existing = { ...validItem, workflowSnapshot: snapshotWithUppercaseField };
    const result = applyCaseUpdateToWixData(existing, { fieldValues: { 0: 'jane smith', 1: 'do not shout this' } });
    expect(result.fieldValues).toEqual({ 0: 'JANE SMITH', 1: 'do not shout this' });
  });

  it('never touches Jotform-sourced rawPayload/original submission data — this module only ever sees a Case patch', () => {
    // Structural assertion, not a runtime one: normalizeCaseTextFields
    // operates purely on the Case patch shape it's given — Jotform's
    // reconciliation apply route (app/api/external-form-submissions/
    // [submissionId]/review/route.ts) builds that Case patch and sends it
    // through PATCH /api/cases/[caseId] exactly like a manual edit; the
    // submission's own rawPayload is never passed to this function at all.
    const { patch } = validateAndPickCaseUpdate({ nextOfKinName: 'John Smith' });
    expect(patch).not.toHaveProperty('rawPayload');
    expect(patch.nextOfKinName).toBe('JOHN SMITH');
  });
});
