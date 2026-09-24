import { describe, expect, it } from 'vitest';
import { normalizeCaseTextFields, normalizeCaseFieldValues } from './textNormalization';
import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';

describe('normalizeCaseTextFields', () => {
  it('uppercases a lowercase value for every allowlisted field', () => {
    const result = normalizeCaseTextFields({
      decedentName: 'john michael smith',
      placeOfDeath: 'broward health medical center',
      nextOfKinName: 'jane smith',
      pickupReleasedTo: 'robert ellison',
      shippingCarrier: 'fedex',
      nextOfKinRelationshipOther: 'family friend',
      pickupNote: 'family will pick up friday afternoon.',
      stalledReason: 'awaiting death certificate',
      tagNumber: 'tag-42',
      shippingTrackingNumber: 'abc123xyz',
    });
    expect(result).toEqual({
      decedentName: 'JOHN MICHAEL SMITH',
      placeOfDeath: 'BROWARD HEALTH MEDICAL CENTER',
      nextOfKinName: 'JANE SMITH',
      pickupReleasedTo: 'ROBERT ELLISON',
      shippingCarrier: 'FEDEX',
      nextOfKinRelationshipOther: 'FAMILY FRIEND',
      pickupNote: 'FAMILY WILL PICK UP FRIDAY AFTERNOON.',
      stalledReason: 'AWAITING DEATH CERTIFICATE',
      tagNumber: 'TAG-42',
      shippingTrackingNumber: 'ABC123XYZ',
    });
  });

  it('uppercases mixed-case values', () => {
    expect(normalizeCaseTextFields({ decedentName: 'JoHn SmItH' })).toEqual({ decedentName: 'JOHN SMITH' });
  });

  it('leaves an already-uppercase value unchanged (idempotent)', () => {
    expect(normalizeCaseTextFields({ decedentName: 'JOHN SMITH' })).toEqual({ decedentName: 'JOHN SMITH' });
  });

  it('normalizes Unicode/diacritic names correctly', () => {
    expect(normalizeCaseTextFields({ decedentName: 'José García' })).toEqual({ decedentName: 'JOSÉ GARCÍA' });
  });

  it('passes null through unchanged for a nullable field', () => {
    expect(normalizeCaseTextFields({ pickupNote: null })).toEqual({ pickupNote: null });
  });

  it('leaves an absent field absent (does not invent a key)', () => {
    const result = normalizeCaseTextFields({ decedentName: 'jane doe' });
    expect('placeOfDeath' in result).toBe(false);
  });

  it('leaves empty string unchanged', () => {
    expect(normalizeCaseTextFields({ decedentName: '' })).toEqual({ decedentName: '' });
  });

  it('does not touch excluded fields even if present on the same object', () => {
    const input = {
      decedentName: 'john smith',
      nextOfKinEmail: 'Jane.Smith@Example.com',
      nextOfKinPhone: '555-0100',
      dateOfBirth: '01/05/1985',
      dateOfDeath: '02/10/2026',
      timeOfDeath: '14:30',
      weight: '178 lb',
      id: 'abc-123-def',
      organizationId: 'org-456',
      caseNumber: 'B2026-034',
      assignedStaffId: 'staff-789',
      createdBy: 'staff-789',
      intakeOwnerId: 'staff-789',
      workflowTemplateId: 'wf-1',
    };
    const result = normalizeCaseTextFields(input);
    expect(result.nextOfKinEmail).toBe('Jane.Smith@Example.com');
    expect(result.nextOfKinPhone).toBe('555-0100');
    expect(result.dateOfBirth).toBe('01/05/1985');
    expect(result.dateOfDeath).toBe('02/10/2026');
    expect(result.timeOfDeath).toBe('14:30');
    expect(result.weight).toBe('178 lb');
    expect(result.id).toBe('abc-123-def');
    expect(result.organizationId).toBe('org-456');
    expect(result.caseNumber).toBe('B2026-034');
    expect(result.assignedStaffId).toBe('staff-789');
    expect(result.createdBy).toBe('staff-789');
    expect(result.intakeOwnerId).toBe('staff-789');
    expect(result.workflowTemplateId).toBe('wf-1');
  });

  it('never touches enum literal fields', () => {
    const input = {
      decedentName: 'john smith',
      paymentStatus: 'awaiting_payment',
      pickupStatus: 'awaiting_pickup',
      returnMethod: 'shipping',
      shippingDeliveryStatus: 'delivered',
      nextOfKinRelationship: 'spouse',
      vaPublishChoice: 'publish',
    };
    const result = normalizeCaseTextFields(input);
    expect(result.paymentStatus).toBe('awaiting_payment');
    expect(result.pickupStatus).toBe('awaiting_pickup');
    expect(result.returnMethod).toBe('shipping');
    expect(result.shippingDeliveryStatus).toBe('delivered');
    expect(result.nextOfKinRelationship).toBe('spouse');
    expect(result.vaPublishChoice).toBe('publish');
  });

  it('does not mutate the input object (pure)', () => {
    const input = { decedentName: 'jane doe' };
    const result = normalizeCaseTextFields(input);
    expect(input.decedentName).toBe('jane doe');
    expect(result).not.toBe(input);
  });
});

function snapshotWithUppercaseFlags(flags: Record<number, boolean>): CaseWorkflowSnapshot {
  return {
    workflowTemplateId: 'wf-1',
    workflowTemplateVersion: 1,
    stages: [],
    intake: {
      sections: [
        {
          key: 'section',
          label: 'Section',
          fields: Object.entries(flags).map(([index, uppercase]) => ({
            key: `field-${index}`,
            label: `Field ${index}`,
            checklistItemIndex: Number(index),
            uppercase,
          })),
        },
      ],
    },
  };
}

describe('normalizeCaseFieldValues', () => {
  it('uppercases only the keys flagged uppercase:true in the workflowSnapshot', () => {
    const snapshot = snapshotWithUppercaseFlags({ 0: true, 1: false });
    const result = normalizeCaseFieldValues({ 0: 'hospice contact', 1: '5551234567' }, snapshot);
    expect(result).toEqual({ 0: 'HOSPICE CONTACT', 1: '5551234567' });
  });

  it('never blindly uppercases every fieldValues entry', () => {
    const snapshot = snapshotWithUppercaseFlags({ 0: false });
    const result = normalizeCaseFieldValues({ 0: 'do not shout this' }, snapshot);
    expect(result).toEqual({ 0: 'do not shout this' });
  });

  it('returns fieldValues unchanged when workflowSnapshot is null', () => {
    const result = normalizeCaseFieldValues({ 0: 'unchanged' }, null);
    expect(result).toEqual({ 0: 'unchanged' });
  });

  it('returns fieldValues unchanged when undefined', () => {
    expect(normalizeCaseFieldValues(undefined, null)).toBeUndefined();
  });

  it('is idempotent for an already-uppercase value', () => {
    const snapshot = snapshotWithUppercaseFlags({ 0: true });
    const once = normalizeCaseFieldValues({ 0: 'ALREADY CAPS' }, snapshot);
    const twice = normalizeCaseFieldValues(once, snapshot);
    expect(twice).toEqual({ 0: 'ALREADY CAPS' });
  });
});
