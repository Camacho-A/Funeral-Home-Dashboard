import { describe, expect, it } from 'vitest';
import { buildCaseViewModel } from './viewModel';
import type { Case } from '../../types/case';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../workflow/snapshot';
import { findStageByRawStage } from '../workflow/resolveStages';
import {
  standardCremationWorkflowTemplateFixture,
  secondOrgWorkflowTemplateFixture,
} from '../../services/__mocks__/workflowTemplates';
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
    tagNumber: null,
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
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

    expect(vm.stageLabel).toBe('Jotform Application');
    expect(vm.stageBadgeVariant).toBe('neutral');
  });

  it('exposes stageLabels in display order, matching the original 7-stage list', () => {
    const case_ = baseCase({});
    const vm = buildCaseViewModel(case_, { staffList: [] });

    expect(vm.stageLabels).toEqual([
      'First Call & Payment',
      'Jotform Application',
      'EDRS & Doctor / Cause of Death',
      'Permit & Authorization Sent to Crematory',
      'DC Application Sent',
      'Ready for Pickup / Contact Family',
      'Completed',
    ]);
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

describe('buildCaseViewModel — JotForm modeled as an integration, not a domain concept', () => {
  it('the Jotform Application stage checklist item carries the integration reference as metadata', () => {
    const case_ = baseCase({ rawStage: 2 });
    const vm = buildCaseViewModel(case_, { staffList: [] });

    expect(vm.checklist).toHaveLength(1);
    expect(vm.checklist[0].label).toBe('Jotform application completed');
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
    const jotformCase = baseCase({ rawStage: 2, checklistState: { 0: true } });
    const ordinaryCase = baseCase({ rawStage: 3, checklistState: { 0: true, 1: true } });

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
    expect(vm.stageLabels).toHaveLength(7); // still Managed Cremations' own 7, not 3
  });
});
