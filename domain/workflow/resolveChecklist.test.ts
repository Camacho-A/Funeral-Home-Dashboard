import { describe, expect, it } from 'vitest';
import { resolveChecklist } from './resolveChecklist';
import type { Case } from '../../types/case';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from './snapshot';
import { standardCremationWorkflowTemplateFixture } from '../../services/__mocks__/workflowTemplates';

/**
 * Case field editing / field-backed checklist sync (2026-09). Weight
 * (checklistItemIndex 3 in the real Managed Cremations template) becoming
 * "done" is never something hooks/useCaseMutations.ts#setWeight computes
 * itself — it only writes fieldValues[3]; resolveChecklist's own
 * pre-existing isFieldDone logic is what then recognizes completion. These
 * tests prove that generic logic against the real production checklist
 * shape (rawStage 0, First Call & Payment), rather than assuming it works.
 */
function baseCase(overrides: Partial<Case>): Case {
  const template = standardCremationWorkflowTemplateFixture;
  const version = latestTemplateVersion(template);
  return {
    id: 'test-case',
    organizationId: 'managed-cremations',
    caseNumber: 'B2026-001',
    decedentName: 'Test Decedent',
    dateOfBirth: '—',
    dateOfDeath: '—',
    timeOfDeath: '—',
    placeOfDeath: '—',
    weight: '—',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: '',
    nextOfKinPhone: '',
    nextOfKinEmail: null,
    nextOfKinRelationship: null,
    nextOfKinRelationshipOther: null,
    tagNumber: null,
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
    checklistState: {},
    fieldValues: {},
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: 'undecided',
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: new Date(0).toISOString(),
    isDeleted: false,
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    caseType: 'cremation',
    workflowSnapshot: buildCaseWorkflowSnapshot(template, version),
    ...overrides,
  };
}

const RAW_STAGE_0_ITEMS = standardCremationWorkflowTemplateFixture.versions[0].stages.find((s) => s.rawStage === 0)!.checklist.items;

describe('resolveChecklist — Weight (checklistItemIndex 3) field-backed completion', () => {
  it('index 3 is labeled Weight in the real template — confirms the test targets the right item', () => {
    expect(RAW_STAGE_0_ITEMS[3].label).toBe('Weight');
    expect(RAW_STAGE_0_ITEMS[3].hasField).toBe(true);
  });

  it('Weight is not done when fieldValues[3] is absent', () => {
    const case_ = baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982' } });
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, case_);
    expect(items[3].done).toBe(false);
  });

  it('5. Weight becomes done once fieldValues[3] has a non-empty value, with no code path other than the existing field-backed logic involved', () => {
    const case_ = baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 3: '210 lb' } });
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, case_);
    expect(items[3].done).toBe(true);
    expect(items[3].fieldValue).toBe('210 lb');
  });

  it('a whitespace-only value does not count as done (matches isFieldDone\'s own trim check)', () => {
    const case_ = baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 3: '   ' } });
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, case_);
    expect(items[3].done).toBe(false);
  });

  it('completing Weight unlocks the next field-backed item (Date of death, index 4)', () => {
    const withoutWeight = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 4: '08/15/2026' } }),
    );
    expect(withoutWeight[4].locked).toBe(true);

    const withWeight = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 3: '210 lb', 4: '08/15/2026' } }),
    );
    expect(withWeight[4].locked).toBe(false);
  });

  it('6/7. checklist resolution never reads checklistState or rawStage for a field-backed item — only fieldValues', () => {
    // A manually-set checklistState[3] must have zero effect on a
    // field-backed item's done/locked resolution — completion is derived
    // from fieldValues alone, never from checklistState (which only
    // matters for plain-toggle items).
    const case_ = baseCase({
      fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982' },
      checklistState: { 3: true },
      rawStage: 5,
    });
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, case_);
    expect(items[3].done).toBe(false);
  });
});
