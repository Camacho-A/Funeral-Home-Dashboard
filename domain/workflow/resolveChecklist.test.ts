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
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, case_);
    expect(items[3].done).toBe(false);
  });

  it('5. Weight becomes done once fieldValues[3] has a non-empty value, with no code path other than the existing field-backed logic involved', () => {
    const case_ = baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 3: '210 lb' } });
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, case_);
    expect(items[3].done).toBe(true);
    expect(items[3].fieldValue).toBe('210 lb');
  });

  it('a whitespace-only value does not count as done (matches isFieldDone\'s own trim check)', () => {
    const case_ = baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 3: '   ' } });
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, case_);
    expect(items[3].done).toBe(false);
  });

  it('completing Weight unlocks the next field-backed item (Date of death, index 4)', () => {
    const withoutWeight = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      0,
      baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 4: '08/15/2026' } }),
    );
    expect(withoutWeight[4].locked).toBe(true);

    const withWeight = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      0,
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
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, case_);
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
      0,
      baseCase({ fieldValues: { 0: 'DECEDENT', 1: 'HOSPITAL', 2: '03/08/1982', 3: '210 lb', 4: '08/15/2026' } }),
    );
    expect(before[5].done).toBe(false);

    const after = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      0,
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
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, case_);
    expect(items[6].done).toBe(false);
  });

  it('not done when only one of the two required fields is set — never "any one populated"', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: null });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, case_)[6].done).toBe(false);

    const flipped = baseCase({ certifierName: null, certifierPhone: '555-0199' });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, flipped)[6].done).toBe(false);
  });

  it('38. done once both certifierName and certifierPhone are non-empty strings', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, case_);
    expect(items[6].done).toBe(true);
  });

  it('a whitespace-only required field does not count as done (matches isFieldDone\'s own trim check)', () => {
    const case_ = baseCase({ certifierName: '   ', certifierPhone: '555-0199' });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, case_)[6].done).toBe(false);
  });

  it('certifierLicenseNumber/certifierFax being null never blocks completion — only Name/Phone are required', () => {
    const case_ = baseCase({
      certifierName: 'DR. JANE FOSTER',
      certifierPhone: '555-0199',
      certifierLicenseNumber: null,
      certifierFax: null,
    });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, case_)[6].done).toBe(true);
  });

  it('isDerived is true for Certifier Information, matching the terminal return-of-remains item\'s existing precedent', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, case_)[6].isDerived).toBe(true);
  });

  it('isDerived is false for every other (non-requiredCaseFields) item', () => {
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, baseCase({}));
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
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, case_)[6].done).toBe(false);
  });

  it('completing Certifier Information unlocks the next item (Family contact, index 7)', () => {
    const notDone = resolveChecklist(
      V5_RAW_STAGE_0_ITEMS,
      0,
      baseCase({ certifierName: null, certifierPhone: null, fieldValues: { 7: 'KAREN — 555-0100' } }),
    );
    expect(notDone[7].locked).toBe(true);

    const done = resolveChecklist(
      V5_RAW_STAGE_0_ITEMS,
      0,
      baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199', fieldValues: { 7: 'KAREN — 555-0100' } }),
    );
    expect(done[7].locked).toBe(false);
  });

  it('a prior undone field-backed item (index 5, Time of death) still locks Certifier Information, exactly like any other item pair', () => {
    const case_ = baseCase({ fieldValues: {}, certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    expect(resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, case_)[6].locked).toBe(true);
  });

  it('valueKind is undefined for a normal item', () => {
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, baseCase({}));
    expect(items[0].valueKind).toBeUndefined();
  });

  it('valueKind is "time" for Time of Death in the v5 template — driven by declarative metadata, not a label match', () => {
    expect(V5_RAW_STAGE_0_ITEMS[5].valueKind).toBe('time');
    const items = resolveChecklist(V5_RAW_STAGE_0_ITEMS, 0, baseCase({}));
    expect(items[5].valueKind).toBe('time');
  });
});

/**
 * Automated-intake checklist fix (2026-10). A case created through
 * `POST /api/cases` — every webhook-created First Call case, and the New
 * Case modal — persists the decedent's details as canonical Case COLUMNS
 * and never writes `fieldValues`. The checklist read only `fieldValues`,
 * so those items rendered blank on a case whose data was fully present.
 *
 * Live example this reproduces exactly: B2026-037 held
 * decedentName "ANGELICA CAMACHO", weight "136", dateOfBirth "02/02/1990"
 * with `fieldValues: {}` and `checklistState: {}`.
 *
 * The decisive safety property, pinned in both directions below: the
 * fallback is DISPLAY ONLY. `done` still requires a real `fieldValues`
 * entry, so no item self-completes and no stage self-advances —
 * `services/workflowReconciliationService.ts` calls this same function.
 */
describe('resolveChecklist — canonical Case field fallback for intake display', () => {
  /** The real intake item indices, asserted rather than assumed. */
  it('targets the right items: name 0, place 1, DOB 2, weight 3, DOD 4, time 5', () => {
    expect(RAW_STAGE_0_ITEMS[0].label).toBe('Name of deceased');
    expect(RAW_STAGE_0_ITEMS[2].label).toBe('Date of birth');
    expect(RAW_STAGE_0_ITEMS[3].label).toBe('Weight');
    expect(RAW_STAGE_0_ITEMS[5].label).toBe('Time of death');
  });

  /** Exactly the live B2026-037 shape: columns populated, fieldValues empty. */
  function webhookCreatedCase(overrides: Partial<Case> = {}): Case {
    return baseCase({
      decedentName: 'ANGELICA CAMACHO',
      dateOfBirth: '02/02/1990',
      dateOfDeath: '10/08/2026',
      timeOfDeath: '11:30',
      weight: '136',
      placeOfDeath: '195 HIGHVIEW AVE',
      fieldValues: {},
      checklistState: {},
      ...overrides,
    });
  }

  it('1. the deceased\'s name displays from the canonical Case column', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase());
    expect(items[0].fieldValue).toBe('ANGELICA CAMACHO');
  });

  it('2. weight displays from the canonical Case column', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase());
    expect(items[3].fieldValue).toBe('136');
  });

  it('3. date of birth displays from the canonical Case column', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase());
    expect(items[2].fieldValue).toBe('02/02/1990');
  });

  it('4. time of death displays from the canonical Case column', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase());
    expect(items[5].fieldValue).toBe('11:30');
  });

  it('place of death and date of death come through the same mapping', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase());
    expect(items[1].fieldValue).toBe('195 HIGHVIEW AVE');
    expect(items[4].fieldValue).toBe('10/08/2026');
  });

  it('5. a missing Case field displays nothing — never a placeholder, never a guess', () => {
    // '—' is what casesService/POST /api/cases store for "not supplied".
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase({ weight: '—', timeOfDeath: '—' }));
    expect(items[3].fieldValue).toBe('');
    expect(items[5].fieldValue).toBe('');
  });

  it('5b. an empty or whitespace-only Case field displays nothing', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase({ weight: '   ', dateOfBirth: '' }));
    expect(items[3].fieldValue).toBe('');
    expect(items[2].fieldValue).toBe('');
  });

  it('6. a malformed value is displayed verbatim, never reformatted or rejected by this layer', () => {
    // Display must not silently "fix" data; the canonical column is the
    // source of truth and parsing/validation belongs to the write paths.
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase({ dateOfBirth: '99/99/9999' }));
    expect(items[2].fieldValue).toBe('99/99/9999');
  });

  it('7. an existing fieldValues entry takes absolute precedence over the Case column', () => {
    const items = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      0,
      webhookCreatedCase({ fieldValues: { 3: '210 lb' } }),
    );
    expect(items[3].fieldValue).toBe('210 lb');
    // And the untouched items still fall back.
    expect(items[0].fieldValue).toBe('ANGELICA CAMACHO');
  });

  it('8. NOTHING is auto-completed — every intake item stays not-done despite every column being populated', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase());
    for (const index of [0, 1, 2, 3, 4, 5]) {
      expect(items[index].done, `item ${index} must not self-complete`).toBe(false);
    }
  });

  it('9. the fallback cannot advance a stage — reconciliation sees the same not-done checklist', () => {
    // Stage advancement is computed from these same `done` flags, so a
    // fully-populated case must still read as incomplete here.
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase());
    expect(items.every((item) => item.done === false || item.isDerived)).toBe(true);
    expect(items.some((item) => item.done && item.hasField)).toBe(false);
  });

  it('10. a manual completion still works and is unaffected by the fallback', () => {
    const items = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      0,
      webhookCreatedCase({ fieldValues: { 0: 'ANGELICA CAMACHO' } }),
    );
    expect(items[0].done).toBe(true);
    expect(items[0].fieldValue).toBe('ANGELICA CAMACHO');
  });

  it('a later stage never borrows an intake value, even at the same item index', () => {
    // `fieldValues` is keyed by a BARE index, so this is the collision the
    // INTAKE_DISPLAY_STAGE guard exists to prevent.
    const laterStage = standardCremationWorkflowTemplateFixture.versions[0].stages.find((s) => s.rawStage === 3)!;
    const items = resolveChecklist(laterStage.checklist.items, laterStage.displayStage, webhookCreatedCase());
    for (const item of items) expect(item.fieldValue).toBe('');
  });

  it('a case with no workflowSnapshot is handled without throwing', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, webhookCreatedCase({ workflowSnapshot: null }));
    expect(items[0].fieldValue).toBe('');
  });

  it('an ambiguous index (Family Contact: name + phone + email) gets no fallback', () => {
    // findCaseFieldForChecklistIndex returns null for an index mapping to
    // more than one Case field, so no half of a combined value is guessed.
    const items = resolveChecklist(
      RAW_STAGE_0_ITEMS,
      0,
      webhookCreatedCase({ nextOfKinName: 'DANIEL OKONKWO', nextOfKinPhone: '(954) 555-0142' }),
    );
    expect(items[7].fieldValue).toBe('');
  });
});

/**
 * Retired checklist items (2026-10). Manors stopped using "Tag photo
 * taken". The item stays in the template at its original index — because
 * `checklistState` is keyed by position and removing it would re-point
 * every later stored key — but it no longer renders or gates the stage.
 */
describe('resolveChecklist — retired checklist items', () => {
  const READY_STAGE = standardCremationWorkflowTemplateFixture.versions[0].stages.find((s) => s.rawStage === 6)!;
  const READY_ITEMS = READY_STAGE.checklist.items;
  const READY_DISPLAY_STAGE = READY_STAGE.displayStage;

  function readyCase(checklistState: Record<string, boolean> = {}, organizationId = 'managed-cremations'): Case {
    return baseCase({ rawStage: 6, organizationId, checklistState });
  }

  it('targets the right item: "Tag photo taken" is index 1 of this stage', () => {
    expect(READY_ITEMS.map((i) => i.label)).toEqual([
      'Ashes picked up (Tue/Fri)',
      'Tag photo taken',
      'Tag/name/cert cross-checked',
      'Labels made',
      'Transferred to urn',
      'Family contacted — ashes ready for pickup',
    ]);
  });

  it('no longer renders it for Manors', () => {
    const items = resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, readyCase());
    expect(items.map((i) => i.label)).not.toContain('Tag photo taken');
    expect(items).toHaveLength(READY_ITEMS.length - 1);
  });

  it('leaves every other item in the stage untouched', () => {
    const items = resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, readyCase());
    expect(items.map((i) => i.label)).toEqual([
      'Ashes picked up (Tue/Fri)',
      'Tag/name/cert cross-checked',
      'Labels made',
      'Transferred to urn',
      'Family contacted — ashes ready for pickup',
    ]);
  });

  it('PRESERVES the original indices, so stored checklistState keeps its meaning', () => {
    // The decisive guarantee. "Tag/name/cert cross-checked" was index 2
    // and must stay index 2 — a stored "5:2" still means that item, not
    // the one after it.
    const items = resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, readyCase());
    expect(items.map((i) => i.index)).toEqual([0, 2, 3, 4, 5]);
    expect(items.find((i) => i.index === 2)!.label).toBe('Tag/name/cert cross-checked');
  });

  it('a historical completion of a later item still reads as done', () => {
    const items = resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, readyCase({ '5:3': true }));
    expect(items.find((i) => i.index === 3)!.label).toBe('Labels made');
    expect(items.find((i) => i.index === 3)!.done).toBe(true);
  });

  it('a historical completion OF the retired item is preserved in state, just not shown', () => {
    const case_ = readyCase({ '5:1': true });
    expect(case_.checklistState['5:1']).toBe(true);
    expect(resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, case_).some((i) => i.index === 1)).toBe(false);
  });

  it('does not block progression — the stage completes without it', () => {
    // Every remaining item checked; the retired one deliberately is not.
    const complete = readyCase({ '5:0': true, '5:2': true, '5:3': true, '5:4': true, '5:5': true });
    const items = resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, complete);
    expect(items.every((i) => i.done)).toBe(true);
  });

  it('never leaves the next item locked behind the hidden one', () => {
    // Item 2 follows the retired item 1; with item 0 done it must be
    // reachable, not blocked by something invisible.
    const items = resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, readyCase({ '5:0': true }));
    expect(items.find((i) => i.index === 2)!.locked).toBe(false);
  });

  it('still locks correctly when the preceding VISIBLE item is incomplete', () => {
    const items = resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, readyCase());
    expect(items.find((i) => i.index === 2)!.locked).toBe(true);
  });

  it('applies to no other organization', () => {
    const items = resolveChecklist(READY_ITEMS, READY_DISPLAY_STAGE, readyCase({}, 'evergreen-memorial-group'));
    expect(items.map((i) => i.label)).toContain('Tag photo taken');
    expect(items).toHaveLength(READY_ITEMS.length);
  });

  it('leaves unrelated stages completely unaffected', () => {
    const items = resolveChecklist(RAW_STAGE_0_ITEMS, 0, baseCase({ organizationId: 'managed-cremations' }));
    expect(items).toHaveLength(RAW_STAGE_0_ITEMS.length);
  });

  it('reappears rather than hiding the wrong item if the template is restructured', () => {
    // Shape guard: the index is the identifier, the label is verified.
    const reordered = READY_ITEMS.map((i) => ({ ...i }));
    reordered[1] = { ...reordered[1], label: 'Something else entirely' };
    const items = resolveChecklist(reordered, READY_DISPLAY_STAGE, readyCase());
    expect(items).toHaveLength(READY_ITEMS.length);
    expect(items.map((i) => i.label)).toContain('Something else entirely');
  });
});
