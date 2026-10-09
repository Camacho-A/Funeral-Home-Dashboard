import { describe, expect, it } from 'vitest';
import { buildCaseViewModel, FAMILY_CONTACT_ITEM_LABEL } from './viewModel';
import { resolveChecklist } from '../workflow/resolveChecklist';
import type { Case } from '../../types/case';
import type { StaffProfile } from '../../types/staffProfile';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../workflow/snapshot';
import { findStageByRawStage } from '../workflow/resolveStages';
import {
  standardCremationWorkflowTemplateFixture,
  secondOrgWorkflowTemplateFixture,
} from '../../services/__mocks__/workflowTemplates';
import { getChecklistLabels } from './checklist';
import { JOTFORM_INTEGRATION_ID } from '../../services/__mocks__/externalFormIntegrations';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';

function baseCase(overrides: Partial<Case>): Case {
  const template = standardCremationWorkflowTemplateFixture;
  const version = latestTemplateVersion(template);
  return {
    id: 'test-case',
    organizationId: DEFAULT_ORGANIZATION_ID,
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

describe('buildCaseViewModel — Managed Cremations fidelity', () => {
  it('resolves the EDRS stage (raw 3) as the attention stage with its known SLA target', () => {
    const case_ = baseCase({ rawStage: 3, daysWaitingInStage: 6 });
    const vm = buildCaseViewModel(case_, { staffList: [] });

    expect(vm.stageLabel).toBe('EDRS & Doctor / Cause of Death');
    expect(vm.stageBadgeVariant).toBe('danger'); // isAttentionStage
    expect(vm.slaTargetDays).toBe(3);
    expect(vm.isOverdue).toBe(true); // 6 days waiting > 3-day target
  });

  it('resolves a non-attention stage as neutral', () => {
    const case_ = baseCase({ rawStage: 2 });
    const vm = buildCaseViewModel(case_, { staffList: [] });

    // Manors intake-stage combination (2026-10): rawStage 2 is canonically
    // "Jotform Application" (display stage 1), which now PRESENTS as the
    // combined intake stage. The canonical position is unchanged — see the
    // dedicated assertion below and workflowStagePresentation.test.ts.
    expect(vm.stageLabel).toBe('Intake & JotForm');
    expect(vm.displayStage).toBe(1); // canonical, untouched
    expect(vm.presentedDisplayStage).toBe(0); // both intake stages present as one
    expect(vm.stageBadgeVariant).toBe('neutral');
  });

  it('exposes stageLabels as the six user-facing Manors stages, in display order', () => {
    const case_ = baseCase({});
    const vm = buildCaseViewModel(case_, { staffList: [] });

    // Manors intake-stage combination (2026-10): the two historical intake
    // stages ("First Call & Payment", "Jotform Application") present as one
    // combined stage. Every later stage keeps its label and relative order.
    expect(vm.stageLabels).toEqual([
      'Intake & JotForm',
      'EDRS & Doctor / Cause of Death',
      'Permit & Authorization Sent to Crematory',
      'DC Application Sent',
      'Ready for Pickup / Contact Family',
      'Completed',
    ]);
    // The combined entry covers both canonical display stages, so a
    // clicked stepper position can still resolve to a canonical stage.
    expect(vm.canonicalDisplayStagesByPresentedIndex[0]).toEqual([0, 1]);
    expect(vm.canonicalDisplayStagesByPresentedIndex[1]).toEqual([2]);
  });

  describe('conditional shipping/tracking (2026-09) — terminal return-of-remains requirement', () => {
    it('an undecided case at the last stage never shows "Completed" — no manual bypass exists', () => {
      const case_ = baseCase({ rawStage: 7, returnMethod: 'undecided' });
      const vm = buildCaseViewModel(case_, { staffList: [] });
      expect(vm.stageLabel).toBe('Ready for Pickup / Contact Family');
      expect(vm.checklist[0].done).toBe(false);
      expect(vm.checklist[0].isDerived).toBe(true);
    });

    it('a pickup case shows "Completed" only once pickupStatus is released', () => {
      const notReleased = baseCase({ rawStage: 7, returnMethod: 'pickup', pickupStatus: 'awaiting_pickup' });
      const released = baseCase({ rawStage: 7, returnMethod: 'pickup', pickupStatus: 'released' });

      expect(buildCaseViewModel(notReleased, { staffList: [] }).stageLabel).toBe('Ready for Pickup / Contact Family');
      expect(buildCaseViewModel(released, { staffList: [] }).stageLabel).toBe('Completed');
    });

    it('a shipping case shows "Completed" only once shippingDeliveryStatus is delivered — tracking number/shipped alone is not enough', () => {
      const noTracking = baseCase({ rawStage: 7, returnMethod: 'shipping' });
      const shippedNotDelivered = baseCase({
        rawStage: 7,
        returnMethod: 'shipping',
        shippingCarrier: 'USPS',
        shippingTrackingNumber: '9400111899223197428019',
        shippingDeliveryStatus: 'shipped',
      });
      const delivered = baseCase({
        rawStage: 7,
        returnMethod: 'shipping',
        shippingCarrier: 'USPS',
        shippingTrackingNumber: '9400111899223197428019',
        shippingDeliveryStatus: 'delivered',
      });

      expect(buildCaseViewModel(noTracking, { staffList: [] }).stageLabel).toBe('Ready for Pickup / Contact Family');
      expect(buildCaseViewModel(shippedNotDelivered, { staffList: [] }).stageLabel).toBe('Ready for Pickup / Contact Family');
      expect(buildCaseViewModel(delivered, { staffList: [] }).stageLabel).toBe('Completed');
    });

    it('the checklistState-stored checkbox no longer has any effect on completion — the old mechanism is fully retired', () => {
      const checkedButNotReleased = baseCase({
        rawStage: 7,
        returnMethod: 'pickup',
        pickupStatus: 'awaiting_pickup',
        checklistState: { 0: true },
      });
      const uncheckedButReleased = baseCase({
        rawStage: 7,
        returnMethod: 'pickup',
        pickupStatus: 'released',
        checklistState: { 0: false },
      });

      expect(buildCaseViewModel(checkedButNotReleased, { staffList: [] }).stageLabel).toBe('Ready for Pickup / Contact Family');
      expect(buildCaseViewModel(uncheckedButReleased, { staffList: [] }).stageLabel).toBe('Completed');
    });

    it('overrides the terminal checklist item label per returnMethod, never rewriting the stored workflowSnapshot', () => {
      const pickup = baseCase({ rawStage: 7, returnMethod: 'pickup', pickupStatus: 'released' });
      const shipping = baseCase({ rawStage: 7, returnMethod: 'shipping', shippingDeliveryStatus: 'delivered' });
      const undecided = baseCase({ rawStage: 7, returnMethod: 'undecided' });

      expect(buildCaseViewModel(pickup, { staffList: [] }).checklist[0].label).toBe('Family picked up ashes');
      expect(buildCaseViewModel(shipping, { staffList: [] }).checklist[0].label).toBe('Cremated remains confirmed delivered');
      expect(buildCaseViewModel(undecided, { staffList: [] }).checklist[0].label).toBe('Return of cremated remains confirmed');
      // The snapshot's own stored item text is untouched — confirmed by
      // reading the terminal stage directly from the snapshot rather than
      // through the overridden view model.
      const terminalStage = findStageByRawStage(pickup.workflowSnapshot!, 7);
      expect(terminalStage?.checklist.items[0]?.label).toBe('Family picked up ashes');
    });

    it('the terminal checklist item is marked read-only/derived — not independently toggleable', () => {
      const case_ = baseCase({ rawStage: 7, returnMethod: 'pickup', pickupStatus: 'released' });
      const vm = buildCaseViewModel(case_, { staffList: [] });
      expect(vm.checklist[0].isDerived).toBe(true);
      // Every non-terminal checklist item stays a normal, independently-
      // toggleable item.
      const midStage = baseCase({ rawStage: 3 });
      const midVm = buildCaseViewModel(midStage, { staffList: [] });
      expect(midVm.checklist.every((item) => item.isDerived === false)).toBe(true);
    });

    describe('Case Detail adaptive heading — presentational only, never the structural stageLabel', () => {
      it('adapts the heading at the stage before Completed based on returnMethod', () => {
        const undecided = baseCase({ rawStage: 6, returnMethod: 'undecided' });
        const pickup = baseCase({ rawStage: 6, returnMethod: 'pickup' });
        const shipping = baseCase({ rawStage: 6, returnMethod: 'shipping' });

        expect(buildCaseViewModel(undecided, { staffList: [] }).caseDetailStageHeading).toBe('Return of Cremated Remains');
        expect(buildCaseViewModel(pickup, { staffList: [] }).caseDetailStageHeading).toBe('Ready for Pickup');
        expect(buildCaseViewModel(shipping, { staffList: [] }).caseDetailStageHeading).toBe('Ready for Shipping');
      });

      it('also adapts when the case rolled back from the terminal stage (rawStage 7, not yet complete)', () => {
        const case_ = baseCase({ rawStage: 7, returnMethod: 'shipping' });
        const vm = buildCaseViewModel(case_, { staffList: [] });
        expect(vm.stageLabel).toBe('Ready for Pickup / Contact Family'); // structural label unchanged
        expect(vm.caseDetailStageHeading).toBe('Ready for Shipping'); // presentational override
      });

      it('never affects stageLabel — reports/dashboard filtering keys off the exact structural text', () => {
        const case_ = baseCase({ rawStage: 6, returnMethod: 'shipping' });
        const vm = buildCaseViewModel(case_, { staffList: [] });
        expect(vm.stageLabel).toBe('Ready for Pickup / Contact Family');
        expect(vm.caseDetailStageHeading).toBe('Ready for Shipping');
      });

      it('is identical to stageLabel everywhere except the one adaptive stage', () => {
        const case_ = baseCase({ rawStage: 3, returnMethod: 'shipping' });
        const vm = buildCaseViewModel(case_, { staffList: [] });
        expect(vm.caseDetailStageHeading).toBe(vm.stageLabel);
        expect(vm.caseDetailStageHeading).toBe('EDRS & Doctor / Cause of Death');
      });
    });
  });
});

describe('buildCaseViewModel — overall progress indicator (Case list scalability, Phase 3, 2026-09)', () => {
  it('is not simply the current stage number — two cases at the same stage with different checklist completion differ', () => {
    // displayStage 2 (EDRS) — composite-keyed per B2026-035's fix
    // (domain/workflow/checklistItemKey.ts).
    const fewerDone = baseCase({ rawStage: 3, checklistState: { '2:0': true, '2:1': false, '2:2': false } });
    const moreDone = baseCase({ rawStage: 3, checklistState: { '2:0': true, '2:1': true, '2:2': true } });
    expect(buildCaseViewModel(moreDone, { staffList: [] }).progressPercent).toBeGreaterThan(
      buildCaseViewModel(fewerDone, { staffList: [] }).progressPercent,
    );
  });

  it('a brand-new case (stage 0, nothing checked yet) is genuinely 0% — checklist default-done fix (2026-10) retired the old free credit for non-last items', () => {
    const case_ = baseCase({ rawStage: 0 });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.progressPercent).toBe(0);
    expect(vm.progressCompletedItems).toBe(0);
    expect(vm.progressTotalItems).toBeGreaterThan(vm.progressCompletedItems);
  });

  it('a genuinely completed case (stageLabel "Completed") is exactly 100% — every stage passed, terminal item satisfied', () => {
    const case_ = baseCase({ rawStage: 7, returnMethod: 'pickup', pickupStatus: 'released' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.stageLabel).toBe('Completed');
    expect(vm.progressPercent).toBe(100);
    expect(vm.progressCompletedItems).toBe(vm.progressTotalItems);
  });

  it('a case at the terminal raw stage that never satisfied the return requirement is below 100% and never shows "Completed" — the inconsistency is surfaced, not hidden', () => {
    const case_ = baseCase({ rawStage: 7, returnMethod: 'undecided' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.stageLabel).not.toBe('Completed');
    expect(vm.progressPercent).toBeLessThan(100);
    expect(vm.progressPercent).toBeGreaterThan(90); // every prior stage still counts fully — only the one terminal item is outstanding
  });

  it('percent is bounded within 0-100 at every stage, from the first to the last', () => {
    for (let rawStage = 0; rawStage <= 7; rawStage++) {
      const vm = buildCaseViewModel(baseCase({ rawStage }), { staffList: [] });
      expect(vm.progressPercent).toBeGreaterThanOrEqual(0);
      expect(vm.progressPercent).toBeLessThanOrEqual(100);
    }
  });

  it('agrees with itself regardless of which past stage Case Detail happens to be viewing read-only — progress always reflects the TRUE current stage, never the viewed one', () => {
    const case_ = baseCase({ rawStage: 3 });
    const viewingCurrent = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: null });
    const viewingPastStage = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(viewingPastStage.progressPercent).toBe(viewingCurrent.progressPercent);
    expect(viewingPastStage.progressCompletedItems).toBe(viewingCurrent.progressCompletedItems);
    expect(viewingPastStage.progressTotalItems).toBe(viewingCurrent.progressTotalItems);
    // The VIEWED checklist does differ (that's the whole point of
    // viewingDisplayStage) — confirming this isn't a trivial no-op case.
    expect(viewingPastStage.checklist).not.toBe(viewingCurrent.checklist);
  });
});

describe('buildCaseViewModel — JotForm modeled as an integration, not a domain concept', () => {
  it('the Jotform Application stage checklist item carries the integration reference as metadata', () => {
    const case_ = baseCase({ rawStage: 2 });
    const vm = buildCaseViewModel(case_, { staffList: [] });

    expect(vm.checklist).toHaveLength(1);
    // Manors uppercase intake labels (2026-10): the Jotform Application
    // stage is one of the two canonical stages presenting as the combined
    // "Intake & JotForm", so its label renders uppercase for this
    // organization. The stored template label is unchanged — see
    // domain/organization/workflowStagePresentation.ts.
    expect(vm.checklist[0].label).toBe('JOTFORM APPLICATION COMPLETED');
    // ChecklistItemViewModel itself has no externalFormIntegrationId field —
    // resolveChecklist deliberately doesn't surface it, since done/locked
    // resolution never branches on it. The reference lives only in the
    // template (proven directly against the fixture, not the view model).
    const templateItem = standardCremationWorkflowTemplateFixture.versions[0].stages.find(
      (s) => s.rawStage === 2,
    )?.checklist.items[0];
    expect(templateItem?.externalFormIntegrationId).toBe(JOTFORM_INTEGRATION_ID);
  });

  it('resolves done/locked identically whether or not a checklist item has an externalFormIntegrationId', () => {
    // Compare the Jotform-linked item (rawStage 2) against an ordinary item
    // (rawStage 3, no integration) — same toggle/lock mechanics either way.
    // displayStage 1 (Jotform Application) and displayStage 2 (EDRS) —
    // composite-keyed per B2026-035's fix (domain/workflow/checklistItemKey.ts).
    const jotformCase = baseCase({ rawStage: 2, checklistState: { '1:0': true } });
    const ordinaryCase = baseCase({ rawStage: 3, checklistState: { '2:0': true, '2:1': true } });

    const jotformVm = buildCaseViewModel(jotformCase, { staffList: [] });
    const ordinaryVm = buildCaseViewModel(ordinaryCase, { staffList: [] });

    expect(jotformVm.checklist[0].done).toBe(true);
    expect(jotformVm.checklist[0].locked).toBe(false);
    expect(ordinaryVm.checklist[1].done).toBe(true);
  });
});

describe('buildCaseViewModel — organization isolation / generalization', () => {
  it("resolves a second organization's differently-shaped template through the exact same function", () => {
    const version = latestTemplateVersion(secondOrgWorkflowTemplateFixture);
    const case_ = baseCase({
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
      rawStage: 1,
      daysWaitingInStage: 3,
      workflowTemplateId: secondOrgWorkflowTemplateFixture.id,
      workflowTemplateVersion: version.version,
      caseType: 'burial',
      workflowSnapshot: buildCaseWorkflowSnapshot(secondOrgWorkflowTemplateFixture, version),
    });

    const vm = buildCaseViewModel(case_, { staffList: [] });

    expect(vm.stageLabel).toBe('Preparation');
    expect(vm.stageBadgeVariant).toBe('danger'); // Preparation is this org's own attention stage
    expect(vm.slaTargetDays).toBe(2);
    expect(vm.isOverdue).toBe(true); // 3 days waiting > 2-day target
    expect(vm.stageLabels).toEqual(['Intake', 'Preparation', 'Service Scheduled']);
    expect(vm.checklist.map((item) => item.label)).toEqual(['Embalming completed']);
  });

  it("a Managed Cremations case is unaffected by the second organization's template existing in the same fixture list", () => {
    const case_ = baseCase({ rawStage: 3 });
    const vm = buildCaseViewModel(case_, { staffList: [] });

    expect(vm.stageLabel).toBe('EDRS & Doctor / Cause of Death');
    // Still Managed Cremations' own workflow, not the second org's 3 —
    // six user-facing stages since the 2026-10 intake combination.
    expect(vm.stageLabels).toHaveLength(6);
    expect(vm.displayStage).toBe(2); // canonical EDRS position, untouched
    expect(vm.presentedDisplayStage).toBe(1); // shifted down by the combined intake stage
  });
});

/**
 * Structured Certifier data — Case checklist terminology consistency
 * (2026-09, ADR-041 follow-up). `baseCase()` above resolves the *latest*
 * template version (v5, since its own live activation), so it already
 * exercises the "new Case" path here; a v1 snapshot is built explicitly for
 * the legacy-presentation-compatibility tests.
 */
describe('buildCaseViewModel — Certifier Information terminology (2026-09, ADR-041)', () => {
  it('1/2. a new v5 Case\'s checklist shows "Certifier Information", never the legacy Hospice/physician wording', () => {
    const case_ = baseCase({ rawStage: 0 });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    const item = vm.checklist[6];
    // Uppercased at render time for Manors' combined intake stage
    // (2026-10); the certifier presentation itself is unchanged.
    expect(item.label).toBe('CERTIFIER INFORMATION');
    expect(vm.checklist.some((i) => i.label.includes('Hospice'))).toBe(false);
  });

  it('3. a new v5 Case\'s Certifier Information item requires Name + Phone (via requiredCaseFields, unaffected by this compat layer)', () => {
    const complete = buildCaseViewModel(
      baseCase({ rawStage: 0, certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' }),
      { staffList: [] },
    );
    expect(complete.checklist[6].done).toBe(true);

    const incomplete = buildCaseViewModel(baseCase({ rawStage: 0, certifierName: 'DR. JANE FOSTER' }), { staffList: [] });
    expect(incomplete.checklist[6].done).toBe(false);
  });

  it('Task #7 reopened (2026-09): a new v5 Case\'s Certifier Information item carries requiredCaseFieldValues from Case.certifierName/certifierPhone, driving the Workflow checklist\'s dual-field editor', () => {
    const vm = buildCaseViewModel(baseCase({ rawStage: 0, certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' }), {
      staffList: [],
    });
    expect(vm.checklist[6].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
    expect(vm.checklist[6].requiredCaseFieldValues).toEqual({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    expect(vm.checklist[6].hasField).toBe(false);
  });

  it('an already-past First Call & Payment stage (v5) still reports "Certifier Information" as the completed item\'s label in the timeline', () => {
    const case_ = baseCase({ rawStage: 2, certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.timeline.some((entry) => entry.what.toLowerCase().includes('certifier information'))).toBe(true);
    expect(vm.timeline.some((entry) => entry.what.toLowerCase().includes('hospice'))).toBe(false);
  });

  describe('legacy (v1) Case presentation compatibility', () => {
    function legacyCase(overrides: Partial<Case> = {}): Case {
      const template = standardCremationWorkflowTemplateFixture;
      const v1 = template.versions[0];
      return baseCase({
        workflowTemplateVersion: v1.version,
        workflowSnapshot: buildCaseWorkflowSnapshot(template, v1),
        ...overrides,
      });
    }

    it('8. a legacy v1 Case\'s checklist displays "Certifier Information" via the compatibility layer', () => {
      const case_ = legacyCase({ rawStage: 0 });
      const vm = buildCaseViewModel(case_, { staffList: [] });
      expect(vm.checklist[6].label).toBe('CERTIFIER INFORMATION');
    });

    it('2. a legacy v1 Case\'s checklist never shows the raw persisted Hospice/physician wording', () => {
      const case_ = legacyCase({ rawStage: 0 });
      const vm = buildCaseViewModel(case_, { staffList: [] });
      expect(vm.checklist.some((i) => i.label.includes('Hospice'))).toBe(false);
    });

    it('9. the persisted workflowSnapshot itself is never modified — the raw stored label is still the legacy wording', () => {
      const case_ = legacyCase({ rawStage: 0 });
      buildCaseViewModel(case_, { staffList: [] }); // build once; assert the source snapshot afterward
      const rawItem = findStageByRawStage(case_.workflowSnapshot!, 0)?.checklist.items[6];
      expect(rawItem?.label).toBe('Hospice or physician who will sign the DC — name & phone number');
    });

    it('a legacy Case with no structured certifier data preserves its exact historical done/locked state (Task #7 follow-up: completion unchanged, editing surface fixed)', () => {
      const case_ = legacyCase({ rawStage: 0, fieldValues: { 6: 'Dr. Choi — 555-0100' } });
      const vm = buildCaseViewModel(case_, { staffList: [] });
      // The old free-text fieldValues[6] entry still drives completion,
      // exactly as it always has — never silently reinterpreted. This must
      // never flip when the display/editing fix below deploys.
      expect(vm.checklist[6].label).toBe('CERTIFIER INFORMATION');
      expect(vm.checklist[6].done).toBe(true);
      // Task #7 follow-up (2026-09): the editing surface is no longer the
      // raw legacy free-text box — it's the structured Name+Phone editor,
      // reading real (here still-blank) Case.certifierName/certifierPhone,
      // never the legacy fieldValues[6] text.
      expect(vm.checklist[6].hasField).toBe(false);
      expect(vm.checklist[6].fieldValue).toBe('');
      expect(vm.checklist[6].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
      expect(vm.checklist[6].requiredCaseFieldValues).toEqual({ certifierName: '', certifierPhone: '' });
    });

    it('10. B2026-034-style legacy Case: the compatibility behavior requires no data migration — same generic function, no per-case special-casing', () => {
      const case_ = legacyCase({ rawStage: 3, fieldValues: { 6: 'Dr. Choi — 555-0100' } });
      const vm = buildCaseViewModel(case_, { staffList: [] });
      // rawStage 3 (past First Call & Payment) — the timeline's past-stage
      // entries relabel too, with zero snapshot mutation.
      expect(vm.timeline.some((entry) => entry.what.toLowerCase().includes('certifier information'))).toBe(true);
      const rawItem = findStageByRawStage(case_.workflowSnapshot!, 0)?.checklist.items[6];
      expect(rawItem?.label).toBe('Hospice or physician who will sign the DC — name & phone number');
    });

    it('once a legacy Case gains structured certifier data (via Case Detail, independent of template version), completion follows the new Name+Phone rule', () => {
      const case_ = legacyCase({ rawStage: 0, certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
      const vm = buildCaseViewModel(case_, { staffList: [] });
      expect(vm.checklist[6].done).toBe(true);
      expect(vm.checklist[6].isDerived).toBe(true);
    });
  });

  it('7. NOK/primary-contact fields remain entirely separate from Certifier Information — distinct Case properties, never conflated', () => {
    const case_ = baseCase({
      nextOfKinName: 'KAREN ELLISON',
      nextOfKinPhone: '555-0100',
      certifierName: 'DR. JANE FOSTER',
      certifierPhone: '555-0199',
    });
    expect(case_.nextOfKinName).not.toBe(case_.certifierName);
    expect(case_.nextOfKinPhone).not.toBe(case_.certifierPhone);
  });
});

/**
 * Task #7 reopened, second follow-up (2026-09). Reproduces the ACTUAL
 * proven Production shape a live read-only diagnostic confirmed: a real
 * Manors case frozen under workflowTemplateVersion 3, now sitting at
 * rawStage 3 (past "First Call & Payment," where the legacy Certifier/
 * dcContact item — index 6, hasField: true — actually lives, at raw
 * stages 0/1). Staff revisiting that earlier stage via the StageStepper
 * were still shown the raw fieldValues[6] free-text box ("DR.SID"),
 * because legacyCertifierPresentation's past-stage branch was a pure
 * label swap. This section proves the fix: the structured Name+Phone
 * editor renders (and is genuinely editable) even when viewed as a past
 * stage, while historical done/locked/progression stay untouched.
 */
describe('buildCaseViewModel — legacy (v3) Certifier past-stage editing (Task #7 reopened, second follow-up, 2026-09)', () => {
  function v3CaseAtRawStage3(overrides: Partial<Case> = {}): Case {
    const template = standardCremationWorkflowTemplateFixture;
    const v1 = template.versions.find((v) => v.version === 1);
    if (!v1) throw new Error('Fixture missing version 1');
    const snapshot = buildCaseWorkflowSnapshot(template, { ...v1, version: 3 });
    return baseCase({
      rawStage: 3,
      workflowTemplateVersion: 3,
      workflowSnapshot: snapshot,
      fieldValues: { 6: 'DR.SID' },
      certifierName: null,
      certifierPhone: null,
      ...overrides,
    });
  }

  it('1. viewing the earlier stage (First Call & Payment) still labels the item "Certifier Information"', () => {
    const case_ = v3CaseAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[6].label).toBe('CERTIFIER INFORMATION');
  });

  it('2. the old editable DR.SID textbox is NOT rendered as the Certifier editor (hasField is false, fieldValue is blank)', () => {
    const case_ = v3CaseAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[6].hasField).toBe(false);
    expect(vm.checklist[6].fieldValue).toBe('');
  });

  it('3/4. the structured Certifier name and phone inputs are present (requiredCaseFields)', () => {
    const case_ = v3CaseAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[6].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
  });

  it('5/6. Name and Phone are initially blank — DR.SID is never guessed into either', () => {
    const case_ = v3CaseAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[6].requiredCaseFieldValues).toEqual({ certifierName: '', certifierPhone: '' });
  });

  it('7/8. DR.SID is not copied into Name or Phone — Case.certifierName/certifierPhone remain null on the source case', () => {
    const case_ = v3CaseAtRawStage3();
    buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(case_.certifierName).toBeNull();
    expect(case_.certifierPhone).toBeNull();
  });

  it('11. fieldValues[6] remains "DR.SID" untouched — merely viewing the past stage never mutates the Case', () => {
    const case_ = v3CaseAtRawStage3();
    buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(case_.fieldValues[6]).toBe('DR.SID');
  });

  it('12. the frozen v3 workflowSnapshot is byte-for-byte unchanged', () => {
    const case_ = v3CaseAtRawStage3();
    const before = JSON.parse(JSON.stringify(case_.workflowSnapshot));
    buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(case_.workflowSnapshot).toEqual(before);
  });

  it('13. rawStage remains 3 — merely viewing an earlier stage never regresses the case\'s real current stage', () => {
    const case_ = v3CaseAtRawStage3();
    buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(case_.rawStage).toBe(3);
  });

  it('14. historical completion state is unchanged: the past-stage item is still done-by-definition, never relocked', () => {
    const case_ = v3CaseAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[6].done).toBe(true);
    expect(vm.checklist[6].locked).toBe(false);
  });

  it('15. unrelated past-stage items remain read-only/historical — only Certifier (6) and Family Contact (7) get the live-editing exception', () => {
    const case_ = v3CaseAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    // Every other item in this past-stage view still reports done (past
    // stage, done-by-definition) with no requiredCaseFields of its own.
    vm.checklist.forEach((item, i) => {
      if (i === 6 || i === 7) return;
      expect(item.done).toBe(true);
      expect(item.requiredCaseFields).toBeUndefined();
    });
  });

  it('the default (current-stage) view of this same case does not show the Certifier item at all — it belongs to an earlier, already-passed stage', () => {
    const case_ = v3CaseAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.checklist.some((i) => i.label === 'Certifier Information')).toBe(false);
  });

  it('once structured data is entered, the past-stage view reflects it — done/locked still untouched', () => {
    const case_ = v3CaseAtRawStage3({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[6].requiredCaseFieldValues).toEqual({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    expect(vm.checklist[6].done).toBe(true);
  });
});

it('FAMILY_CONTACT_ITEM_LABEL matches the actual frozen label — guards against silent drift', () => {
  expect(FAMILY_CONTACT_ITEM_LABEL).toBe(getChecklistLabels(0)[7]);
});

/**
 * Task #5 FINAL fix (2026-09). "Family contact — name, phone number &
 * email" (checklistItemIndex 7) reuses the SAME structured multi-field
 * presentation Certifier Information already uses — Name, Phone, AND
 * Email each get their own editable row, mirroring Certifier's own
 * Name/Phone rows exactly. Unlike Certifier, this item never got a
 * v5-style requiredCaseFields completion upgrade, so `done`/`locked` are
 * NEVER touched by applyFamilyContactPresentation in any branch (current
 * or past stage) — only the editing surface changes. Reproduces the same
 * class of real Manors legacy v3 case used throughout Task #6/#7: frozen
 * workflowTemplateVersion 3, now past the stage where this item lives,
 * with the old combined "name — phone" fieldValues[7] entry still intact.
 */
describe('buildCaseViewModel — Family Contact structured Workflow presentation (Task #5 FINAL fix, 2026-09)', () => {
  function v3CaseWithFamilyContactAtRawStage3(overrides: Partial<Case> = {}): Case {
    const template = standardCremationWorkflowTemplateFixture;
    const v1 = template.versions.find((v) => v.version === 1);
    if (!v1) throw new Error('Fixture missing version 1');
    const snapshot = buildCaseWorkflowSnapshot(template, { ...v1, version: 3 });
    return baseCase({
      rawStage: 3,
      workflowTemplateVersion: 3,
      workflowSnapshot: snapshot,
      fieldValues: { 7: 'KAREN ELLISON — 555-0100' },
      nextOfKinName: '',
      nextOfKinPhone: '',
      nextOfKinEmail: null,
      ...overrides,
    });
  }

  it('1/2. the Family Contact structured editor renders with all three requiredCaseFields (name, phone, email) when viewing the earlier stage', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[7].requiredCaseFields).toEqual(['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail']);
    expect(vm.checklist[7].hasField).toBe(false);
    expect(vm.checklist[7].fieldValue).toBe('');
  });

  it('5. structured field values are initially blank when the structured Case fields are blank', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[7].requiredCaseFieldValues).toEqual({
      nextOfKinName: '',
      nextOfKinPhone: '',
      nextOfKinEmail: '',
    });
  });

  it('6/7. the legacy combined "KAREN ELLISON — 555-0100" text is never copied into any field, and fieldValues[7] is never surfaced through the hasField textbox path', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    const values = vm.checklist[7].requiredCaseFieldValues ?? {};
    expect(values.nextOfKinName).not.toContain('KAREN');
    expect(JSON.stringify(values)).not.toContain(' — ');
    expect(vm.checklist[7].hasField).toBe(false);
    expect(vm.checklist[7].fieldValue).toBe('');
  });

  it('12. the legacy combined fieldValues[7] value remains unchanged — merely viewing never mutates the Case', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3();
    buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(case_.fieldValues[7]).toBe('KAREN ELLISON — 555-0100');
  });

  it('the frozen v3 workflowSnapshot is byte-for-byte unchanged', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3();
    const before = JSON.parse(JSON.stringify(case_.workflowSnapshot));
    buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(case_.workflowSnapshot).toEqual(before);
  });

  it('rawStage remains unchanged', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3();
    buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(case_.rawStage).toBe(3);
  });

  it('historical completion state is unchanged: the past-stage item is still done-by-definition, exactly as before this change', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[7].done).toBe(true);
    expect(vm.checklist[7].locked).toBe(false);
  });

  it('unrelated past-stage items remain read-only/historical — only Certifier (6) and Family Contact (7) get the exception', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3();
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    vm.checklist.forEach((item, i) => {
      if (i === 6 || i === 7) return;
      expect(item.requiredCaseFields).toBeUndefined();
    });
  });

  it('current-stage (non-past) view also shows the structured editor for a case that still has this item in its current stage', () => {
    const template = standardCremationWorkflowTemplateFixture;
    const v1 = template.versions.find((v) => v.version === 1);
    if (!v1) throw new Error('Fixture missing version 1');
    const case_ = baseCase({
      rawStage: 0,
      workflowTemplateVersion: 3,
      workflowSnapshot: buildCaseWorkflowSnapshot(template, { ...v1, version: 3 }),
      fieldValues: { 7: 'KAREN ELLISON — 555-0100' },
      nextOfKinName: '',
      nextOfKinPhone: '',
      nextOfKinEmail: null,
    });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.checklist[7].requiredCaseFields).toEqual(['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail']);
    expect(vm.checklist[7].hasField).toBe(false);
  });

  it('11. clean/new case: displays the real structured Name/Phone/Email values, matching Case Information exactly', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3({
      nextOfKinName: 'KAREN ELLISON',
      nextOfKinPhone: '555-0155',
      nextOfKinEmail: 'karen@example.com',
    });
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[7].requiredCaseFieldValues).toEqual({
      nextOfKinName: 'KAREN ELLISON',
      nextOfKinPhone: '555-0155',
      nextOfKinEmail: 'karen@example.com',
    });
    expect(case_.nextOfKinName).toBe(vm.checklist[7].requiredCaseFieldValues?.nextOfKinName);
  });

  it('14. cases without NOK email still render safely (empty string, never null/undefined/crash)', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3({
      nextOfKinName: 'KAREN ELLISON',
      nextOfKinPhone: '555-0155',
      nextOfKinEmail: null,
    });
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[7].requiredCaseFieldValues?.nextOfKinEmail).toBe('');
  });

  it('13. a corrupted nextOfKinName ("NAME — PHONE") is still recognized as Family Contact and displays the clean name only', () => {
    const case_ = v3CaseWithFamilyContactAtRawStage3({
      nextOfKinName: 'EMMA MORALES SILVA — (954) 901-4165',
      nextOfKinPhone: '(954) 901-4165',
      nextOfKinEmail: null,
    });
    const vm = buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 0 });
    expect(vm.checklist[7].requiredCaseFields).toEqual(['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail']);
    expect(vm.checklist[7].requiredCaseFieldValues?.nextOfKinName).toBe('EMMA MORALES SILVA');
    expect(vm.checklist[7].requiredCaseFieldValues?.nextOfKinPhone).toBe('(954) 901-4165');
  });

  it('is a no-op for a template with no nextOfKinName checklist mapping at all (e.g. secondOrgWorkflowTemplateFixture)', () => {
    const case_ = baseCase({
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
      workflowSnapshot: buildCaseWorkflowSnapshot(secondOrgWorkflowTemplateFixture, latestTemplateVersion(secondOrgWorkflowTemplateFixture)),
    });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.checklist.every((item) => item.requiredCaseFields === undefined)).toBe(true);
  });
});

/**
 * Task #5 FINAL fix (2026-09). A real case's workflowSnapshot can have an
 * `intake` that doesn't wire nextOfKinName to any checklistItemIndex at
 * all (e.g. an onboarding-provisioned organization's simpler starter
 * template — see domain/onboarding/starterWorkflow.ts) — the primary,
 * metadata-driven lookup in applyFamilyContactPresentation has nothing to
 * resolve. Reproduced here by giving a real cremation-template snapshot
 * an empty `intake` (mirroring the "is a no-op..." test above) while
 * keeping the stage's own checklist item — and its legacy joined
 * fieldValues[7] — intact.
 *
 * The fallback identifies the item by its own frozen LABEL
 * (FAMILY_CONTACT_ITEM_LABEL) — never by comparing fieldValue text
 * against the case's *current* nextOfKinName, which was the prior
 * fallback's actual bug: once nextOfKinName is itself corrupted to
 * "NAME — PHONE" (the exact reported production shape), a text-value
 * comparison (`fieldValue.startsWith(nextOfKinName + ' — ')`) can never
 * recognize it, since it ends up searching for
 * "NAME — PHONE — ", which never appears.
 */
describe('buildCaseViewModel — Family Contact label-based identification fallback (Task #5 FINAL fix, 2026-09)', () => {
  function caseWithUnmappedIntake(overrides: Partial<Case> = {}): Case {
    const template = standardCremationWorkflowTemplateFixture;
    const v1 = template.versions.find((v) => v.version === 1);
    if (!v1) throw new Error('Fixture missing version 1');
    const snapshot = buildCaseWorkflowSnapshot(template, v1);
    return baseCase({
      rawStage: 0,
      workflowSnapshot: { ...snapshot, intake: { sections: [] } },
      fieldValues: { 7: 'EMMA MORALES SILVA — (954) 901-4165' },
      nextOfKinName: 'EMMA MORALES SILVA',
      nextOfKinPhone: '(954) 901-4165',
      nextOfKinEmail: null,
      ...overrides,
    });
  }

  it('1/2. the fallback still converts the item to the structured editor (all three requiredCaseFields, hasField false) for a clean case', () => {
    const case_ = caseWithUnmappedIntake();
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.checklist[7].requiredCaseFields).toEqual(['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail']);
    expect(vm.checklist[7].hasField).toBe(false);
  });

  it('the phone number is no longer part of the rendered fieldValue (never shown beside the name)', () => {
    const case_ = caseWithUnmappedIntake();
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.checklist[7].fieldValue).toBe('');
    expect(vm.checklist[7].fieldValue).not.toContain('901-4165');
  });

  it('Case.nextOfKinPhone/nextOfKinName remain unchanged after building the view model', () => {
    const case_ = caseWithUnmappedIntake();
    buildCaseViewModel(case_, { staffList: [] });
    expect(case_.nextOfKinPhone).toBe('(954) 901-4165');
    expect(case_.nextOfKinName).toBe('EMMA MORALES SILVA');
  });

  it('the original persisted legacy fieldValues[7] value remains unchanged', () => {
    const case_ = caseWithUnmappedIntake();
    buildCaseViewModel(case_, { staffList: [] });
    expect(case_.fieldValues[7]).toBe('EMMA MORALES SILVA — (954) 901-4165');
  });

  it('the frozen workflowSnapshot is byte-for-byte unchanged — merely viewing never mutates the Case', () => {
    const case_ = caseWithUnmappedIntake();
    const before = JSON.parse(JSON.stringify(case_.workflowSnapshot));
    buildCaseViewModel(case_, { staffList: [] });
    expect(case_.workflowSnapshot).toEqual(before);
  });

  it('does not fire for an unrelated hasField item with a different label (no false positive)', () => {
    const case_ = caseWithUnmappedIntake({
      fieldValues: { 3: '210 lb', 7: 'EMMA MORALES SILVA — (954) 901-4165' },
    });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    // Weight (index 3) is untouched by this presentation function.
    expect(vm.checklist[3]?.requiredCaseFields).toBeUndefined();
  });

  it('13. CORRUPTED CASE (the exact Task #5 production shape): identification succeeds even though nextOfKinName itself already equals the joined "NAME — PHONE" string', () => {
    const case_ = caseWithUnmappedIntake({
      nextOfKinName: 'EMMA MORALES SILVA — (954) 901-4165',
      nextOfKinPhone: '(954) 901-4165',
    });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.checklist[7].requiredCaseFields).toEqual(['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail']);
    expect(vm.checklist[7].hasField).toBe(false);
    // The displayed name is the safely-normalized clean value, not the raw corrupted string.
    expect(vm.checklist[7].requiredCaseFieldValues?.nextOfKinName).toBe('EMMA MORALES SILVA');
    expect(vm.checklist[7].requiredCaseFieldValues?.nextOfKinName).not.toContain(' — ');
  });

  it('identification succeeds even when nextOfKinName is entirely blank (label match never depends on any text value) — a behavior change from the old text-matching fallback', () => {
    const case_ = caseWithUnmappedIntake({ nextOfKinName: '', nextOfKinPhone: '' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.checklist[7].hasField).toBe(false);
    expect(vm.checklist[7].requiredCaseFields).toEqual(['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail']);
  });
});

/**
 * Case Information sync fix (2026-09). Weight/Time of Death legacy
 * fieldValues compatibility fallback — see resolveFieldWithLegacyFallback
 * in ./viewModel.ts for the full "why." checklistItemIndex 3 = weight,
 * 5 = timeOfDeath on the standard cremation template (same indices the
 * write-side sync fix tests use in lib/wixCaseMapper.test.ts /
 * services/casesService.test.ts).
 */
describe('buildCaseViewModel — Weight/Time of Death legacy fieldValues fallback (2026-09)', () => {
  it('5. the structured field displays even when the legacy fieldValues mirror is missing entirely (the common, already-synced case)', () => {
    const case_ = baseCase({ weight: '178 lb', timeOfDeath: '14:30', fieldValues: {} });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.weight).toBe('178 lb');
    expect(vm.timeOfDeath).toBe('14:30');
  });

  it('the structured field always wins when both representations are present', () => {
    const case_ = baseCase({ weight: '178 lb', fieldValues: { 3: '999 lb' } });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.weight).toBe('178 lb');
  });

  it('falls back to the legacy fieldValues mirror when the structured field is genuinely unset ("—")', () => {
    const case_ = baseCase({ weight: '—', fieldValues: { 3: '178 lb' } });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.weight).toBe('178 lb');
  });

  it('falls back for Time of Death the same way, normalizing a legacy 12-hour mirror value to canonical 24-hour', () => {
    const case_ = baseCase({ timeOfDeath: '—', fieldValues: { 5: '02:15 PM' } });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.timeOfDeath).toBe('14:15');
  });

  it('weightOver200 is computed from the fallback-resolved value, not the blank structured field', () => {
    const case_ = baseCase({ weight: '—', fieldValues: { 3: '215 lb' } });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.weight).toBe('215 lb');
    expect(vm.weightOver200).toBe(true);
  });

  it('shows the unset placeholder ("—") when neither the structured field nor the legacy mirror has a real value', () => {
    const case_ = baseCase({ weight: '—', fieldValues: {} });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.weight).toBe('—');
    expect(vm.weightOver200).toBe(false);
  });

  it('B2026-034-style legacy case: falls back correctly with no data migration, same generic function used for every case', () => {
    const case_ = baseCase({ weight: '—', timeOfDeath: '—', fieldValues: { 3: '178 lb', 5: '06:12' }, rawStage: 3 });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.weight).toBe('178 lb');
    expect(vm.timeOfDeath).toBe('06:12');
  });

});

/**
 * Task #6 follow-up (2026-09) — reproduces the ACTUAL proven Production
 * shape, not another synthetic approximation: a real Manors case frozen
 * under workflowTemplateVersion 3, whose Time of Death checklist item
 * predates `valueKind: 'time'` (hasField: true, valueKind absent/null),
 * with a legacy free-text fieldValues[5] entry ("11:30AM") a staff member
 * typed by hand. The read-only Production diagnostic (browser console)
 * confirmed this exact shape: workflowTemplateId
 * 'workflow-template-standard-cremation', workflowTemplateVersion 3,
 * Case.timeOfDeath unset, fieldValues[5] === '11:30AM'.
 */
describe('buildCaseViewModel — legacy (v3) Time of Death 12-hour compatibility (Task #6 follow-up, 2026-09)', () => {
  function v3Case(overrides: Partial<Case>): Case {
    const template = standardCremationWorkflowTemplateFixture;
    const v1 = template.versions.find((v) => v.version === 1);
    if (!v1) throw new Error('Fixture missing version 1');
    // v1's stages/intake already have the pre-ADR-041 shape (hasField:
    // true, no valueKind, mapsToCaseField: 'timeOfDeath') — only the
    // version NUMBER differs from the real case (3 vs. this fixture's 1),
    // and workflowSnapshot resolution never reads the version number
    // itself, only the stages/intake it carries, so stamping 3 here
    // reproduces the real shape exactly without inventing a parallel v3
    // template definition.
    const snapshot = buildCaseWorkflowSnapshot(template, { ...v1, version: 3 });
    return baseCase({
      workflowTemplateVersion: 3,
      workflowSnapshot: snapshot,
      ...overrides,
    });
  }

  it('checklist index 5 has no valueKind and hasField is true — confirms the reproduced shape matches the real diagnostic', () => {
    const case_ = v3Case({ timeOfDeath: '—', fieldValues: { 5: '11:30AM' } });
    const item = case_.workflowSnapshot?.stages
      .flatMap((s) => s.checklist.items)
      .find((i) => i.index === 5);
    expect(item?.hasField).toBe(true);
    expect(item?.valueKind).toBeUndefined();
  });

  it('resolves the legacy "11:30AM" fieldValues mirror to canonical "11:30" in the view model', () => {
    const case_ = v3Case({ timeOfDeath: '—', fieldValues: { 5: '11:30AM' } });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.timeOfDeath).toBe('11:30');
  });

  it('merely building the view model (reading/rendering) never mutates the Case — fieldValues[5] remains the original "11:30AM"', () => {
    const case_ = v3Case({ timeOfDeath: '—', fieldValues: { 5: '11:30AM' } });
    buildCaseViewModel(case_, { staffList: [] });
    expect(case_.fieldValues[5]).toBe('11:30AM');
    expect(case_.timeOfDeath).toBe('—');
  });

  it('preserves the safe blank/placeholder behavior when the legacy value cannot be parsed — never guesses', () => {
    const case_ = v3Case({ timeOfDeath: '—', fieldValues: { 5: 'unknown' } });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.timeOfDeath).toBe('—');
  });

  it('the structured field still wins outright once it has a real canonical value (unaffected by the legacy path)', () => {
    const case_ = v3Case({ timeOfDeath: '09:00', fieldValues: { 5: '11:30AM' } });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.timeOfDeath).toBe('09:00');
  });
});

/**
 * Item #7 (2026-09, decedent avatar fix). `decedentInitials` is derived from
 * `Case.decedentName` via the same corrected `initialsFromName` helper item
 * #6 fixed for employee avatars — never from the assigned staff owner,
 * case number, NOK, or certifier. See resolveDecedentInitials in
 * ./viewModel.ts.
 */
describe('buildCaseViewModel — decedentInitials (item #7, 2026-09)', () => {
  const assignedStaff: StaffProfile = {
    id: 'staff-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    identityId: 'identity-1',
    membershipId: null,
    displayName: 'Priya Nair',
    role: 'funeral_director',
    isActive: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };

  it('1. "John Smith" -> "JS"', () => {
    const case_ = baseCase({ decedentName: 'John Smith' });
    expect(buildCaseViewModel(case_, { staffList: [] }).decedentInitials).toBe('JS');
  });

  it('2. "Maria Rodriguez" -> "MR"', () => {
    const case_ = baseCase({ decedentName: 'Maria Rodriguez' });
    expect(buildCaseViewModel(case_, { staffList: [] }).decedentInitials).toBe('MR');
  });

  it('3. does not use the first two letters of the first name (e.g. never "JO" for "John Smith")', () => {
    const case_ = baseCase({ decedentName: 'John Smith' });
    expect(buildCaseViewModel(case_, { staffList: [] }).decedentInitials).not.toBe('JO');
  });

  it('4. a named case does not display "?" as its avatar', () => {
    const case_ = baseCase({ decedentName: 'Robert Williams' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.decedentInitials).toBe('RW');
    expect(vm.decedentInitials).not.toBe('?');
  });

  it('5. first-name-only case -> first initial', () => {
    const case_ = baseCase({ decedentName: 'John' });
    expect(buildCaseViewModel(case_, { staffList: [] }).decedentInitials).toBe('J');
  });

  it('6. last-name-only case (a single trailing name) -> that name\'s own initial', () => {
    const case_ = baseCase({ decedentName: 'Smith' });
    expect(buildCaseViewModel(case_, { staffList: [] }).decedentInitials).toBe('S');
  });

  it('7. a completely unnamed case safely falls back to "?", never "undefined"/"NaN"/blank', () => {
    const case_ = baseCase({ decedentName: '' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.decedentInitials).toBe('?');
    expect(vm.decedentInitials).not.toContain('undefined');
    expect(vm.decedentInitials).not.toContain('NaN');
  });

  it('8. the visible Case name remains exactly the persisted decedentName ("First Last"), unmodified', () => {
    const case_ = baseCase({ decedentName: 'Robert Williams' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.decedentName).toBe('Robert Williams');
  });

  it('9. the case number is never used for decedent initials', () => {
    const case_ = baseCase({ decedentName: 'John Smith', caseNumber: 'B2026-999' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.decedentInitials).toBe('JS');
    expect(vm.decedentInitials).not.toContain('9');
  });

  it('10. the NOK name is never used for decedent initials', () => {
    const case_ = baseCase({ decedentName: 'John Smith', nextOfKinName: 'Angelica Camacho' });
    const vm = buildCaseViewModel(case_, { staffList: [] });
    expect(vm.decedentInitials).toBe('JS');
    expect(vm.decedentInitials).not.toBe('AC');
  });

  it('11. the assigned staff owner is never used for decedent initials', () => {
    const case_ = baseCase({ decedentName: 'John Smith', assignedStaffId: assignedStaff.id });
    const vm = buildCaseViewModel(case_, { staffList: [assignedStaff] });
    expect(vm.ownerInitials).toBe('PN'); // the owner's own, separate, correctly-computed initials
    expect(vm.decedentInitials).toBe('JS'); // unaffected by who owns the case
  });

  it('13. reuses the shared initialsFromName helper rather than a duplicate algorithm — proven by identical edge-case behavior (middle name ignored, exactly like item #6)', () => {
    const case_ = baseCase({ decedentName: 'Angelica Maria Camacho' });
    expect(buildCaseViewModel(case_, { staffList: [] }).decedentInitials).toBe('AC');
  });
});

/**
 * B2026-035 progress regression (2026-10). Concrete proof that
 * computeCaseProgress (domain/cases/progress.ts) cannot be inflated by
 * the fixed cross-stage index collision: it never reads checklistState
 * for a non-current stage at all — a future stage's contribution is
 * always "0 completed, its own item count toward the total," regardless
 * of any checklistState entry. Permit & Authorization's own composite key
 * ("3:1") is explicitly set true here; DC Application Sent (the very
 * stage that collided with it under the old flat-index architecture) is
 * a future stage from this case's own rawStage (4), so its contribution
 * must be exactly its own item count with zero credited, never inflated.
 */
describe('buildCaseViewModel — progress is immune to the cross-stage checklist collision (B2026-035)', () => {
  it('Permit\'s own composite-keyed completion never credits DC Application Sent\'s item count', () => {
    const template = standardCremationWorkflowTemplateFixture;
    const version = latestTemplateVersion(template);
    const snapshot = buildCaseWorkflowSnapshot(template, version);
    const permitStage = findStageByRawStage(snapshot, 4)!; // displayStage 3, 2 items
    const dcStage = findStageByRawStage(snapshot, 5)!; // displayStage 4, 2 items — collided with Permit under the old bug
    expect(permitStage.checklist.items).toHaveLength(2);
    expect(dcStage.checklist.items).toHaveLength(2);

    const case_ = baseCase({
      rawStage: 4,
      // Permit's own current stage is meant to read as fully done, so both
      // of its 2 items need an explicit composite key now — checklist
      // default-done fix (2026-10) retired the old free credit for item 0.
      checklistState: { '3:0': true, '3:1': true },
    });
    const vm = buildCaseViewModel(case_, { staffList: [] });

    // Every stage strictly before Permit (First Call & Payment combined
    // 11 items, Jotform 1, EDRS 3 — 15 total) is fully credited by the
    // "past stage" rule; Permit itself (current stage, 2 items) is fully
    // done; every stage at/after DC Application Sent (DC 2, Ready for
    // Pickup 6, Completed 1 — 9 total) contributes 0 completed, its own
    // item count toward the total.
    expect(vm.progressCompletedItems).toBe(15 + 2); // 17 — DC's 2 items contribute nothing
    expect(vm.progressTotalItems).toBe(15 + 2 + 9); // 26
    expect(vm.progressPercent).toBe(65); // round(17/26 * 100)

    // The direct mechanism: DC Application Sent's own resolved checklist
    // (evaluated independently, the same way Case Detail would show it if
    // viewed) must still read its item 1 as NOT done — the collision is
    // fixed at the source, not merely absent from this one aggregate.
    const dcResolved = resolveChecklist(dcStage.checklist.items, dcStage.displayStage, case_, { isPastStage: false });
    expect(dcResolved[1].done).toBe(false);
  });
});

/**
 * Automated-intake checklist fix + Manors uppercase intake labels
 * (2026-10). Reproduces the exact live shape of a webhook-created First
 * Call case: canonical Case columns populated, `fieldValues` and
 * `checklistState` empty (live example B2026-037).
 */
describe('buildCaseViewModel — webhook-created intake case (canonical columns, no fieldValues)', () => {
  function webhookCase(overrides: Partial<Case> = {}): Case {
    return baseCase({
      decedentName: 'ANGELICA CAMACHO',
      dateOfBirth: '02/02/1990',
      dateOfDeath: '10/08/2026',
      timeOfDeath: '11:30',
      weight: '136',
      placeOfDeath: '195 HIGHVIEW AVE',
      rawStage: 0,
      fieldValues: {},
      checklistState: {},
      ...overrides,
    });
  }

  it('the four reported fields all display in the Intake checklist', () => {
    const vm = buildCaseViewModel(webhookCase(), { staffList: [] });
    const byLabel = (needle: string) => vm.checklist.find((i) => i.label.includes(needle));
    expect(byLabel('NAME OF DECEASED')?.fieldValue).toBe('ANGELICA CAMACHO');
    expect(byLabel('WEIGHT')?.fieldValue).toBe('136');
    expect(byLabel('DATE OF BIRTH')?.fieldValue).toBe('02/02/1990');
    expect(byLabel('TIME OF DEATH')?.fieldValue).toBe('11:30');
  });

  it('Phase 2: the checklist and the Case Overview show the SAME values — one source of truth', () => {
    const vm = buildCaseViewModel(webhookCase(), { staffList: [] });
    const byLabel = (needle: string) => vm.checklist.find((i) => i.label.includes(needle))?.fieldValue;
    expect(byLabel('NAME OF DECEASED')).toBe(vm.decedentName);
    expect(byLabel('WEIGHT')).toBe(vm.weight);
    expect(byLabel('DATE OF BIRTH')).toBe(vm.dateOfBirth);
    expect(byLabel('TIME OF DEATH')).toBe(vm.timeOfDeath);
  });

  it('no checklist item self-completes, and the case stays on the intake stage', () => {
    const vm = buildCaseViewModel(webhookCase(), { staffList: [] });
    expect(vm.checklist.some((i) => i.done && i.hasField)).toBe(false);
    expect(vm.displayStage).toBe(0);
  });

  it('Manors renders the combined intake checklist labels in uppercase', () => {
    const vm = buildCaseViewModel(webhookCase(), { staffList: [] });
    for (const item of vm.checklist) {
      expect(item.label).toBe(item.label.toUpperCase());
    }
  });

  it('18. another organization keeps its original label casing and is otherwise unchanged', () => {
    const vm = buildCaseViewModel(
      webhookCase({ organizationId: SECOND_MOCK_ORGANIZATION_ID }),
      { staffList: [] },
    );
    expect(vm.checklist.some((i) => i.label !== i.label.toUpperCase())).toBe(true);
    // The canonical-column fallback is organization-independent, so the
    // values still display for them too.
    const name = vm.checklist.find((i) => i.label.toLowerCase().includes('name of deceased'));
    expect(name?.fieldValue).toBe('ANGELICA CAMACHO');
    expect(name?.done).toBe(false);
  });

  it('a typed fieldValues entry still wins over the canonical column', () => {
    const vm = buildCaseViewModel(webhookCase({ fieldValues: { 3: '210 lb' } }), { staffList: [] });
    expect(vm.checklist.find((i) => i.label.includes('WEIGHT'))?.fieldValue).toBe('210 lb');
  });
});
