import { buildCaseWorkflowSnapshot } from './snapshot';
import { displayStagesInOrder } from './resolveStages';
import { checklistItemKey } from './checklistItemKey';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import { buildGusServiceWorkflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '../../services/__mocks__/workflowTemplates';
import type { Case } from '../../types/case';
import type { StageTemplate, WorkflowTemplate, WorkflowTemplateVersion } from '../../types/workflowTemplate';

/**
 * TEST-ONLY fixtures for the cross-service regression suites
 * (domain/workflow/crossServiceRegression.test.ts and
 * app/api/cases/crossServiceStages.test.ts). A FICTIONAL second approved
 * Gus workflow — burial-shaped, 5 display / 6 raw stages, against Direct
 * Cremation's 7 / 8 — sharing "First Call & Payment", "Death Certificate
 * Application Sent" and "Completed" and adding two labels of its own, plus
 * fictional cases spread across both workflows. Nothing here is a real
 * workflow, case or person, and no application code imports this module.
 */

export const GUS = 'gus-camacho-jr';
export const BURIAL_ID = 'workflow-template-test-fictional-burial';

export function item(index: number, label: string) {
  return { index, label, hasField: false, isPasswordField: false, externalFormIntegrationId: null };
}

/** The fictional burial workflow: display 0 covers raw 0 and 1, like
    Direct Cremation; 7 checklist items in all. */
export function burialStages(): StageTemplate[] {
  const firstCall = [item(0, 'Fictional family call logged'), item(1, 'Fictional service fee noted')];
  return [
    { rawStage: 0, displayStage: 0, label: 'First Call & Payment', isAttentionStage: false, slaTargetDays: 0.25, checklist: { items: firstCall } },
    { rawStage: 1, displayStage: 0, label: 'First Call & Payment', isAttentionStage: false, slaTargetDays: 0.25, checklist: { items: firstCall } },
    { rawStage: 2, displayStage: 1, label: 'Cemetery Arrangements', isAttentionStage: true, slaTargetDays: 2, checklist: { items: [item(0, 'Fictional plot confirmed'), item(1, 'Fictional opening ordered')] } },
    // Shared label, LONGER target than Direct Cremation's 2 days.
    { rawStage: 3, displayStage: 2, label: 'Death Certificate Application Sent', isAttentionStage: false, slaTargetDays: 3, checklist: { items: [item(0, 'Fictional application filed')] } },
    { rawStage: 4, displayStage: 3, label: 'Graveside Service Held', isAttentionStage: false, slaTargetDays: 1, checklist: { items: [item(0, 'Fictional service held')] } },
    { rawStage: 5, displayStage: 4, label: 'Completed', isAttentionStage: false, slaTargetDays: null, checklist: { items: [item(0, 'Fictional committal confirmed')] } },
  ];
}

export function burialVersion(version: number, stages: StageTemplate[], status: 'approved' | 'draft' = 'approved'): WorkflowTemplateVersion {
  const intake = structuredClone(buildGusServiceWorkflowTemplateFixtures()[0].versions[0].intake);
  return { version, caseTypes: ['burial'], stages, intake, createdAt: '2026-10-02T00:00:00.000Z', status };
}

export function burialTemplate(versions: WorkflowTemplateVersion[] = [burialVersion(1, burialStages())]): WorkflowTemplate {
  return {
    id: BURIAL_ID,
    organizationId: GUS,
    name: 'Fictional Graveside Burial',
    isEnabled: true,
    caseTypes: ['burial'],
    serviceTypeCodes: ['GRAVESIDE_BURIAL_SERVICE_ONLY'],
    versions,
  };
}

/** Gus' real templates with the draft Graveside Burial template replaced
    by the fictional approved one. Cremation with Viewing / Final Goodbye
    are left out: they run the very same cremation stages as Direct
    Cremation (2026-11), so the scenario stays "two approved workflows of
    different lengths". */
export const SAME_AS_DIRECT_CREMATION = ['CREMATION_WITH_VIEWING', 'CREMATION_WITH_FINAL_GOODBYE'];
export function gusTemplatesWithBurial(burial: WorkflowTemplate = burialTemplate()): WorkflowTemplate[] {
  return [
    ...buildGusServiceWorkflowTemplateFixtures().filter(
      (t) => !t.serviceTypeCodes?.some((code) => code === 'GRAVESIDE_BURIAL_SERVICE_ONLY' || SAME_AS_DIRECT_CREMATION.includes(code)),
    ),
    burial,
  ];
}

const baseGusCase = (): Case => structuredClone(caseFixtures.find((c) => c.organizationId === GUS)!);

export type CaseOptions = Partial<Pick<Case, 'daysWaitingInStage' | 'isStalled' | 'stalledReason' | 'checklistState' | 'assignedStaffId'>> & {
  /** Return of remains recorded (pickup released) — what lets a case on
      its terminal stage read as Completed. */
  released?: boolean;
};

export function caseOn(template: WorkflowTemplate, version: WorkflowTemplateVersion, id: string, rawStage: number, options: CaseOptions = {}): Case {
  const { released = false, ...rest } = options;
  return {
    ...baseGusCase(),
    id,
    caseNumber: `FICT-${id.toUpperCase()}`,
    rawStage,
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    checklistState: {},
    fieldValues: {},
    returnMethod: released ? 'pickup' : 'undecided',
    pickupStatus: released ? 'released' : 'awaiting_pickup',
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    caseType: template.caseTypes[0],
    workflowSnapshot: buildCaseWorkflowSnapshot(template, version),
    ...rest,
  };
}

export const templates = gusTemplatesWithBurial();
export const direct = templates.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
export const directV = direct.versions[0];
export const burial = templates.find((t) => t.id === BURIAL_ID)!;
export const burialV = burial.versions[0];

/** Fictional cases, both workflows, every interesting position. */
export function crossServiceCases(): Case[] {
  return [
    caseOn(direct, directV, 'dc-01', 0),
    caseOn(direct, directV, 'dc-02', 1, { daysWaitingInStage: 1 }),
    caseOn(direct, directV, 'dc-03', 3, { daysWaitingInStage: 5, isStalled: true, stalledReason: 'Fictional: waiting on physician' }),
    // Direct Cremation's DC Application Sent: target 2 days -> overdue at 3.
    caseOn(direct, directV, 'dc-04', 5, { daysWaitingInStage: 3 }),
    caseOn(direct, directV, 'dc-05', 7, { released: true }),
    // On the terminal stage, return of remains not yet recorded: held one
    // stage back ("Ready for Pickup / Contact Family") and still active.
    caseOn(direct, directV, 'dc-06', 7, { daysWaitingInStage: 2 }),
    caseOn(burial, burialV, 'bu-01', 0),
    caseOn(burial, burialV, 'bu-02', 2, { daysWaitingInStage: 3, isStalled: true, stalledReason: 'Fictional: cemetery not confirmed' }),
    // Same label as dc-04, same wait — burial's own 3-day target: on time.
    caseOn(burial, burialV, 'bu-03', 3, { daysWaitingInStage: 3 }),
    caseOn(burial, burialV, 'bu-04', 4),
    caseOn(burial, burialV, 'bu-05', 5, { released: true }),
    caseOn(burial, burialV, 'bu-06', 5, { daysWaitingInStage: 1 }),
  ];
}

export const EXPECTED_LABELS = [
  'First Call & Payment',
  'JotForm Application',
  'Cemetery Arrangements',
  'EDRS & Doctor / Cause of Death',
  'Permit & Authorization Sent to Crematory',
  'Graveside Service Held',
  'Death Certificate Application Sent',
  'Ready for Pickup / Contact Family',
  'Completed',
];

/** checklistState with every burial item ticked. */
export function everyBurialItemChecked(): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const stage of displayStagesInOrder(buildCaseWorkflowSnapshot(burial, burialV))) {
    for (const entry of stage.checklist.items) state[checklistItemKey(stage.displayStage, entry.index)] = true;
  }
  return state;
}
