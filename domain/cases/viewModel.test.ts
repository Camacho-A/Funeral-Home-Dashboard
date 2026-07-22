import { describe, expect, it } from 'vitest';
import { buildCaseViewModel } from './viewModel';
import type { Case } from '../../types/case';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../workflow/snapshot';
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
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    checklistState: {},
    fieldValues: {},
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

  it('does not show "Completed" until the last stage\'s first checklist item (ashes picked up) is done', () => {
    const notPickedUp = baseCase({ rawStage: 7, checklistState: { 0: false } });
    const pickedUp = baseCase({ rawStage: 7, checklistState: { 0: true } });

    expect(buildCaseViewModel(notPickedUp, { staffList: [] }).stageLabel).toBe(
      'Ready for Pickup / Contact Family',
    );
    expect(buildCaseViewModel(pickedUp, { staffList: [] }).stageLabel).toBe('Completed');
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
