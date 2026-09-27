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
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
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

describe('resolveChecklist — Time of Death (checklistItemIndex 5) field-backed completion (2026-09)', () => {
  it('index 5 is labeled Time of death in the real template — confirms the test targets the right item', () => {
    expect(RAW_STAGE_0_ITEMS[5].label).toBe('Time of death');
    expect(RAW_STAGE_0_ITEMS[5].hasField).toBe(true);
  });

  it('6. Time of Death becomes done once fieldValues[5] has a non-empty value, through the existing generic field-backed logic', () => {
    const before = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 3: '210 lb', 4: '08/15/2026' } }),
    );
    expect(before[5].done).toBe(false);

    const after = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 3: '210 lb', 4: '08/15/2026', 5: '15:45' } }),
    );
    expect(after[5].done).toBe(true);
    expect(after[5].fieldValue).toBe('15:45');
  });

  it('the v1 template\'s Time of Death has no valueKind — v1 is never retroactively modified by v5', () => {
    expect(RAW_STAGE_0_ITEMS[5].valueKind).toBeUndefined();
  });
});

/**
 * Structured Certifier data (2026-09, ADR-041) — the generic
 * requiredCaseFields-driven completion mechanism, exercised against the
 * real v5 template (never a hand-authored item list), proving it reads
 * structured Case fields directly and completely bypasses
 * fieldValues/checklistState for this one item — the same "generic, not
 * label-hardcoded" mechanism any future multi-required-field item reuses.
 */
const V5_TEMPLATE_VERSION = standardCremationWorkflowTemplateFixture.versions.find((v) => v.version === 5)!;
const V5_RAW_STAGE_0_ITEMS = V5_TEMPLATE_VERSION.stages.find((s) => s.rawStage === 0)!.checklist.items;

describe('resolveChecklist — Certifier Information (requiredCaseFields) generic multi-field completion (2026-09, ADR-041)', () => {
  it('36. index 6 in the v5 template is "Certifier Information", hasField:false, requiredCaseFields: [certifierName, certifierPhone]', () => {
    expect(V5_RAW_STAGE_0_ITEMS[6].label).toBe('Certifier Information');
    expect(V5_RAW_STAGE_0_ITEMS[6].hasField).toBe(false);
    expect(V5_RAW_STAGE_0_ITEMS[6].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
  });

  it('37. not done when both required Case fields are null', () => {
    const case_ = baseCase({ certifierName: null, certifierPhone: null });
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, case_);
    expect(items[6].done).toBe(false);
  });

  it('not done when only one of the two required fields is set — never "any one populated"', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: null });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, case_)[6].done).toBe(false);

    const flipped = baseCase({ certifierName: null, certifierPhone: '555-0199' });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, flipped)[6].done).toBe(false);
  });

  it('38. done once both certifierName and certifierPhone are non-empty strings', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, case_);
    expect(items[6].done).toBe(true);
  });

  it('a whitespace-only required field does not count as done (matches isFieldDone\'s own trim check)', () => {
    const case_ = baseCase({ certifierName: '   ', certifierPhone: '555-0199' });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, case_)[6].done).toBe(false);
  });

  it('certifierLicenseNumber/certifierFax being null never blocks completion — only Name/Phone are required', () => {
    const case_ = baseCase({
      certifierName: 'DR. JANE FOSTER',
      certifierPhone: '555-0199',
      certifierLicenseNumber: null,
      certifierFax: null,
    });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, case_)[6].done).toBe(true);
  });

  it('isDerived is true for Certifier Information, matching the terminal return-of-remains item\'s existing precedent', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, case_)[6].isDerived).toBe(true);
  });

  it('isDerived is false for every other (non-requiredCaseFields) item', () => {
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, baseCase({}));
    expect(items[0].isDerived).toBe(false);
    expect(items[5].isDerived).toBe(false);
  });

  it('checklistState/fieldValues have zero effect on Certifier Information — completion reads structured Case fields only', () => {
    const case_ = baseCase({
      certifierName: null,
      certifierPhone: null,
      checklistState: { 6: true },
      fieldValues: { 6: 'something' },
    });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, case_)[6].done).toBe(false);
  });

  it('completing Certifier Information unlocks the next item (Family contact, index 7)', () => {
    const notDone = resolveChecklist(
      V5_RAW_STAGE_0_ITEMS,
      baseCase({ certifierName: null, certifierPhone: null, fieldValues: { 7: 'KAREN — 555-0100' } }),
    );
    expect(notDone[7].locked).toBe(true);

    const done = resolveChecklist(
      V5_RAW_STAGE_0_ITEMS,
      baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199', fieldValues: { 7: 'KAREN — 555-0100' } }),
    );
    expect(done[7].locked).toBe(false);
  });

  it('a prior undone field-backed item (index 5, Time of death) still locks Certifier Information, exactly like any other item pair', () => {
    const case_ = baseCase({ fieldValues: {}, certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, case_)[6].locked).toBe(true);
  });

  it('valueKind is undefined for a normal item', () => {
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, baseCase({}));
    expect(items[0].valueKind).toBeUndefined();
  });

  it('valueKind is "time" for Time of Death in the v5 template — driven by declarative metadata, not a label match', () => {
    expect(V5_RAW_STAGE_0_ITEMS[5].valueKind).toBe('time');
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, baseCase({}));
    expect(items[5].valueKind).toBe('time');
  });
});
