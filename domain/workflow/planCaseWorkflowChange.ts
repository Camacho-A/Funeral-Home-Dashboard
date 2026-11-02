import type { Case, CaseWorkflowHistoryEntry } from '../../types/case';
import type { CaseWorkflowSnapshot, WorkflowTemplate } from '../../types/workflowTemplate';
import { buildCaseWorkflowSnapshot } from './snapshot';
import { remapCaseWorkflow, type KeptItem, type NotCarriedItem, type RemappedItem } from './remapCaseWorkflow';
import { selectWorkflowTemplate, type WorkflowSelectionOptions, type WorkflowSelectionRefusalReason } from './selectWorkflowTemplate';

/**
 * Service-specific workflows (2026-10). Everything POST
 * /api/cases/[caseId]/workflow (and the mock-mode client path in
 * services/casesService.ts) decides about a service-type change, as one
 * pure function: which workflow the new service uses (the SAME selection
 * rule as case creation — only an approved version, never a draft), what
 * happens to the case's progress (remapCaseWorkflow), and the exact case
 * fields to write if staff confirm. Nothing is written here.
 */

export type WorkflowChangeSide = {
  workflowTemplateId: string;
  workflowTemplateVersion: number;
  workflowName: string | null;
  serviceTypeCode: string | null;
  stageLabel: string | null;
};

export type WorkflowChangePreview = {
  /** True when the selected service already uses the case's workflow —
      nothing to confirm, nothing will be written. */
  unchanged: boolean;
  from: WorkflowChangeSide;
  to: WorkflowChangeSide;
  kept: KeptItem[];
  notCarried: NotCarriedItem[];
  newRequirements: RemappedItem[];
  movesBackward: boolean;
};

export type WorkflowChangeWrite = {
  workflowTemplateId: string;
  workflowTemplateVersion: number;
  workflowSnapshot: CaseWorkflowSnapshot;
  caseType: string;
  rawStage: number;
  checklistState: Record<string, boolean>;
  fieldValues: Record<number, string>;
  /** The case's state BEFORE the change; changedAt/changedByUserId are
      stamped by the writer. */
  previous: Omit<CaseWorkflowHistoryEntry, 'changedAt' | 'changedByUserId'>;
};

export type WorkflowChangeRefusalReason =
  | WorkflowSelectionRefusalReason
  | 'stale_workflow'
  | 'no_current_workflow';

export type WorkflowChangePlan =
  | { ok: true; preview: WorkflowChangePreview; write: WorkflowChangeWrite | null }
  | { ok: false; status: 409 | 422; reason: WorkflowChangeRefusalReason; message: string };

function templateName(templates: readonly WorkflowTemplate[], templateId: string): string | null {
  return templates.find((t) => t.id === templateId)?.name ?? null;
}

export function planCaseWorkflowChange(
  case_: Case,
  templates: readonly WorkflowTemplate[],
  input: { serviceTypeCode: string; expectedWorkflowTemplateId: string },
  options: WorkflowSelectionOptions = {},
): WorkflowChangePlan {
  // Optimistic concurrency: the preview staff confirmed was computed
  // against this exact workflow. If the case moved since, re-preview.
  if (case_.workflowTemplateId !== input.expectedWorkflowTemplateId) {
    return {
      ok: false,
      status: 409,
      reason: 'stale_workflow',
      message: "This case's workflow changed since the preview was shown. Reload the case and try again.",
    };
  }
  const oldSnapshot = case_.workflowSnapshot;
  if (!oldSnapshot) {
    return { ok: false, status: 422, reason: 'no_current_workflow', message: 'This case has no workflow on record to change from.' };
  }

  // Gus Phase 5C-3 (finalization): a case already on a service that has since
  // been deactivated may still be re-planned on that SAME service — the
  // deactivation only stops it being chosen for new cases or switched to.
  const ownService = oldSnapshot.serviceTypeCode ?? null;
  const selectionOptions =
    ownService && input.serviceTypeCode === ownService && options.activeServiceTypeCodes && !options.activeServiceTypeCodes.includes(ownService)
      ? { ...options, activeServiceTypeCodes: [...options.activeServiceTypeCodes, ownService] }
      : options;
  const selection = selectWorkflowTemplate(templates, case_.organizationId, input.serviceTypeCode, selectionOptions);
  if (!selection.ok) return { ok: false, status: 422, reason: selection.reason, message: selection.message };

  const from: WorkflowChangeSide = {
    workflowTemplateId: case_.workflowTemplateId,
    workflowTemplateVersion: case_.workflowTemplateVersion,
    workflowName: templateName(templates, case_.workflowTemplateId),
    serviceTypeCode: oldSnapshot.serviceTypeCode ?? null,
    stageLabel: oldSnapshot.stages.find((s) => s.rawStage === case_.rawStage)?.label ?? null,
  };

  // Same template: the service change doesn't change the workflow. Never
  // an implicit upgrade to a newer version either — the case keeps the
  // snapshot it has.
  if (selection.template.id === case_.workflowTemplateId) {
    return {
      ok: true,
      preview: { unchanged: true, from, to: { ...from, serviceTypeCode: selection.serviceTypeCode }, kept: [], notCarried: [], newRequirements: [], movesBackward: false },
      write: null,
    };
  }

  const newSnapshot = buildCaseWorkflowSnapshot(selection.template, selection.version, selection.serviceTypeCode);
  const remap = remapCaseWorkflow(case_, oldSnapshot, newSnapshot);

  return {
    ok: true,
    preview: {
      unchanged: false,
      from,
      to: {
        workflowTemplateId: selection.template.id,
        workflowTemplateVersion: selection.version.version,
        workflowName: selection.template.name,
        serviceTypeCode: selection.serviceTypeCode,
        stageLabel: remap.newStageLabel,
      },
      kept: remap.kept,
      notCarried: remap.notCarried,
      newRequirements: remap.newRequirements,
      movesBackward: remap.movesBackward,
    },
    write: {
      workflowTemplateId: selection.template.id,
      workflowTemplateVersion: selection.version.version,
      workflowSnapshot: newSnapshot,
      caseType: selection.version.caseTypes[0] ?? case_.caseType,
      rawStage: remap.newRawStage,
      checklistState: remap.newChecklistState,
      fieldValues: remap.newFieldValues,
      previous: {
        workflowTemplateId: case_.workflowTemplateId,
        workflowTemplateVersion: case_.workflowTemplateVersion,
        serviceTypeCode: oldSnapshot.serviceTypeCode ?? null,
        rawStage: case_.rawStage,
        checklistState: { ...case_.checklistState },
        fieldValues: { ...case_.fieldValues },
      },
    },
  };
}

/** Applies a confirmed plan to an in-memory Case (mock mode). The previous
    state is appended to workflowHistory — never replaced. */
export function applyWorkflowChangeToCase(
  case_: Case,
  write: WorkflowChangeWrite,
  stamp: { changedAt: string; changedByUserId: string },
): Case {
  return {
    ...case_,
    workflowTemplateId: write.workflowTemplateId,
    workflowTemplateVersion: write.workflowTemplateVersion,
    workflowSnapshot: write.workflowSnapshot,
    caseType: write.caseType,
    rawStage: write.rawStage,
    checklistState: write.checklistState,
    fieldValues: write.fieldValues,
    daysWaitingInStage: 0,
    workflowHistory: [...(case_.workflowHistory ?? []), { ...write.previous, ...stamp }],
  };
}
