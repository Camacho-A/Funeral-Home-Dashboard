import type { StageTemplate, WorkflowComposition, WorkflowCompletionPolicy, WorkflowTemplate, WorkflowVersionSource } from '../../types/workflowTemplate';
import { groupStagesByDisplayStage, isTerminalStageLabel, TERMINAL_STAGE_LABEL } from './templateEditing';
import { findUnmodifiedCopySource, isPlaceholderStageLabel, validateCompletionPolicy } from './completionPolicy';

/**
 * Workflow template editor (2026-10). THE validation of a workflow
 * template version's stages — pure, shared by the editor (live feedback)
 * and, authoritatively, by the server: POST .../versions runs the 'draft'
 * level before saving, POST .../versions/[version]/approve runs the
 * 'approval' level before a version may go live. The editor's own checks
 * are a convenience only; a forged request meets the same rules.
 *
 * TWO LEVELS
 *
 * 'draft' — structural coherence. Anything failing it cannot even be
 * stored, because the engine could not resolve it (stage lookup by
 * rawStage, checklist keys "{displayStage}:{index}"):
 *   - at least one stage;
 *   - rawStage equals the stage's position (0, 1, 2 … no gaps);
 *   - displayStage starts at 0 and each raw stage either shares the
 *     previous raw stage's displayStage or is exactly one more;
 *   - raw stages sharing a display stage share its label and its checklist
 *     (same number of items, same labels, in the same order) — they are
 *     ONE checklist as far as stored completion is concerned;
 *   - item index equals the item's position;
 *   - stage and item labels are non-empty;
 *   - slaTargetDays is null or a finite number ≥ 0;
 *   - any proposed service assignment names only active `service_type`
 *     catalog codes, each at most once.
 * A work-in-progress draft (an empty new stage, a duplicate name while
 * renaming, a placeholder "to be defined" stage) passes this level.
 *
 * 'approval' — everything above, plus completeness for live cases:
 *   - at least 2 display stages;
 *   - the final display stage is the TERMINAL stage: its label, trimmed
 *     and case-insensitive, is exactly "Completed". The engine already
 *     treats the last display stage as terminal (never overdue, the case's
 *     end state, where the return-of-remains requirement is presented);
 *     requiring the name makes that explicit rather than accidental;
 *   - display stage labels are unique (case-insensitive) — the
 *     organization-wide stage list groups cases by stage NAME
 *     (domain/workflow/organizationStages.ts);
 *   - every non-final display stage has at least one checklist item (a
 *     stage with nothing to do could never be worked or completed);
 *   - item labels are unique within a stage (case-insensitive) —
 *     completion rules match some items by label (resolveChecklist.ts);
 *   - data-entry items (hasField) appear only in the first display stage:
 *     Case.fieldValues is keyed by a bare item index that only the intake
 *     stage may own (resolveChecklist.ts's INTAKE_DISPLAY_STAGE);
 *   - requiredCaseFields names only supported structured Case fields and
 *     is never combined with hasField (the item's value lives on the Case,
 *     see types/workflowTemplate.ts);
 *   - slaTargetDays is a whole number of days, or a same-day target
 *     strictly between 0 and 1 — the existing First Call & Payment target
 *     is 0.25, which domain/cases/sla.ts's formatSlaTarget renders as
 *     "same day", so a strict "integers only" rule would reject the
 *     approved Direct Cremation workflow itself;
 *   - for an organization that selects workflows by service type, the
 *     template serves at least one service, and no other ENABLED template
 *     of the organization already serves any of them (at most one enabled
 *     template per service — domain/workflow/selectWorkflowTemplate.ts
 *     refuses ambiguity at case creation; this stops it being created).
 *
 * Service-specific completion & unfinished-workflow protection (2026-10),
 * approval level only, each driven by the context below:
 *   - no stage is a placeholder ("… — steps to be defined"), even one an
 *     item was added to without naming the real step;
 *   - when the organization requires a completion policy, the version has
 *     one, and it passes domain/workflow/completionPolicy.ts's
 *     validateCompletionPolicy (a burial/entombment policy with no
 *     required final items is "to be defined" and refused);
 *   - with `checkUnmodifiedCopy`, a version whose stages, items and
 *     completion requirements are still identical to another template's
 *     (its `derivedFrom` source, or any other template of the
 *     organization) is refused — an unreviewed copy is not this service's
 *     workflow.
 * A supplied completion policy is also checked at the 'draft' level for
 * coherence (a known kind, well-formed references).
 */

export type WorkflowValidationLevel = 'draft' | 'approval';

export type WorkflowValidationProblem = {
  /** Stable machine code, for tests and UI grouping. */
  code: string;
  /** Staff-facing sentence. Positions in it are 1-based. */
  message: string;
  /** 0-based display-stage position, when the problem is about one stage. */
  stagePosition?: number;
  /** 0-based item position within that stage. */
  itemPosition?: number;
  /** The lowest level that reports this problem. */
  level: WorkflowValidationLevel;
};

/** Structured Case fields an item may be completed from
    (ChecklistItemTemplate.requiredCaseFields) — the string fields staff
    edit on Case Information. */
export const REQUIRED_CASE_FIELD_OPTIONS = [
  { field: 'certifierName', label: 'Certifier — name' },
  { field: 'certifierPhone', label: 'Certifier — phone number' },
  { field: 'certifierLicenseNumber', label: 'Certifier — license number' },
  { field: 'certifierFax', label: 'Certifier — fax number' },
  { field: 'nextOfKinName', label: 'Next of kin — name' },
  { field: 'nextOfKinPhone', label: 'Next of kin — phone number' },
  { field: 'nextOfKinEmail', label: 'Next of kin — email' },
] as const;

const REQUIRED_CASE_FIELDS = new Set<string>(REQUIRED_CASE_FIELD_OPTIONS.map((option) => option.field));

export type WorkflowValidationContext = {
  /** The service assignment being saved/approved. Omitted = not part of
      this check (organizations without service-specific workflows). */
  serviceTypeCodes?: readonly string[] | null;
  /** The organization's ACTIVE `service_type` catalog codes. Omitted = no
      catalog to check against. */
  activeServiceTypeCodes?: readonly string[];
  /** Approval level: require at least one service. */
  requireServiceAssignment?: boolean;
  /** Approval level: the organization's templates, for the one-enabled-
      template-per-service rule. */
  organizationTemplates?: readonly WorkflowTemplate[];
  /** The template being validated (excluded from that rule) and whether
      it is enabled (a disabled template claims nothing). */
  templateId?: string;
  templateIsEnabled?: boolean;
  /** Display name for a service code in messages. */
  serviceDisplayName?: (code: string) => string | null | undefined;
  /** Service-specific completion (2026-10). The completion policy being
      saved/approved — omitted = not part of this check (every caller
      that predates it, and organizations without approval). */
  completionPolicy?: WorkflowCompletionPolicy | null;
  /** Approval level: a completion policy must be present. */
  requireCompletionPolicy?: boolean;
  /** Approval level: refuse a version identical to another template's
      (its `derivedFrom` source first, else any other template of
      `organizationTemplates`) — an unreviewed copy. */
  checkUnmodifiedCopy?: boolean;
  /** The version's copy source, when it has one. */
  derivedFrom?: WorkflowVersionSource | null;
  /** The shared base it is composed from (2026-11), when it has one. */
  composition?: WorkflowComposition | null;
};

const norm = (label: string) => label.trim().toLowerCase();

export function validateWorkflowStages(
  stages: readonly StageTemplate[],
  level: WorkflowValidationLevel,
  context: WorkflowValidationContext = {},
): WorkflowValidationProblem[] {
  const problems: WorkflowValidationProblem[] = [];
  const add = (p: Omit<WorkflowValidationProblem, 'level'>, at: WorkflowValidationLevel = 'draft') => problems.push({ ...p, level: at });
  const serviceName = (code: string) => context.serviceDisplayName?.(code) || code;

  // ---- draft (structural) -------------------------------------------------

  if (stages.length === 0) {
    add({ code: 'no_stages', message: 'At least one stage is required.' });
    return problems;
  }

  stages.forEach((stage, i) => {
    if (stage.rawStage !== i) {
      add({ code: 'raw_stage_sequence', message: `Stage at position ${i + 1} has rawStage ${stage.rawStage}, expected ${i}.` });
    }
    const previous = stages[i - 1];
    const expectedDisplay = previous ? [previous.displayStage, previous.displayStage + 1] : [0];
    if (!expectedDisplay.includes(stage.displayStage)) {
      add({
        code: 'display_stage_sequence',
        message: `Stage at position ${i + 1} has displayStage ${stage.displayStage}; expected ${expectedDisplay.join(' or ')}.`,
      });
    }
  });

  const groups = groupStagesByDisplayStage(stages);

  groups.forEach((group, g) => {
    const primary = group[0];
    const name = primary.label.trim() || `Stage ${g + 1}`;
    if (!primary.label.trim()) {
      add({ code: 'stage_label_empty', message: `Stage ${g + 1} must have a non-empty label.`, stagePosition: g });
    }
    if (group.some((stage) => stage.label !== primary.label)) {
      add({ code: 'combined_stage_label', message: `The combined stage "${name}" has raw stages with different labels.`, stagePosition: g });
    }
    for (const stage of group) {
      const sla = stage.slaTargetDays;
      if (sla !== null && (typeof sla !== 'number' || !Number.isFinite(sla) || sla < 0)) {
        add({ code: 'sla_invalid', message: `Stage "${name}" has an invalid SLA target — it must be empty or a number of days of 0 or more.`, stagePosition: g });
        break;
      }
    }
    group.forEach((stage) => {
      stage.checklist.items.forEach((item, itemIndex) => {
        if (item.index !== itemIndex) {
          add({
            code: 'item_index_sequence',
            message: `Checklist item at position ${itemIndex + 1} in stage "${name}" has index ${item.index}, expected ${itemIndex}.`,
            stagePosition: g,
            itemPosition: itemIndex,
          });
        }
      });
    });
    primary.checklist.items.forEach((item, itemIndex) => {
      if (!item.label.trim()) {
        add({
          code: 'item_label_empty',
          message: `Checklist item ${itemIndex + 1} in stage "${name}" must have a non-empty label.`,
          stagePosition: g,
          itemPosition: itemIndex,
        });
      }
    });
    const primaryLabels = primary.checklist.items.map((item) => item.label);
    if (group.slice(1).some((stage) => stage.checklist.items.length !== primaryLabels.length || stage.checklist.items.some((item, i) => item.label !== primaryLabels[i]))) {
      add({ code: 'combined_stage_checklist', message: `The combined stage "${name}" has raw stages with different checklists.`, stagePosition: g });
    }
  });

  if (context.serviceTypeCodes) {
    const seen = new Set<string>();
    for (const code of context.serviceTypeCodes) {
      if (seen.has(code)) add({ code: 'service_duplicate', message: `${serviceName(code)} is assigned more than once.` });
      seen.add(code);
      if (context.activeServiceTypeCodes && !context.activeServiceTypeCodes.includes(code)) {
        add({ code: 'service_unknown', message: `"${serviceName(code)}" is not one of this organization's active service types.` });
      }
    }
  }

  if (context.completionPolicy) {
    problems.push(...validateCompletionPolicy(context.completionPolicy, stages, 'draft'));
  }

  if (level === 'draft') return problems;

  // ---- approval (complete) ------------------------------------------------

  const approval = (p: Omit<WorkflowValidationProblem, 'level'>) => add(p, 'approval');

  if (groups.length < 2) {
    approval({ code: 'too_few_stages', message: 'A workflow needs at least 2 stages.' });
  }
  const final = groups[groups.length - 1];
  if (!isTerminalStageLabel(final[0].label)) {
    approval({
      code: 'final_stage_not_terminal',
      message: `The last stage must be the terminal "${TERMINAL_STAGE_LABEL}" stage (it is "${final[0].label.trim() || 'unnamed'}").`,
      stagePosition: groups.length - 1,
    });
  }

  const seenStageLabels = new Map<string, number>();
  groups.forEach((group, g) => {
    const primary = group[0];
    const name = primary.label.trim() || `Stage ${g + 1}`;
    const key = norm(primary.label);
    if (key && seenStageLabels.has(key)) {
      approval({ code: 'stage_label_duplicate', message: `Stage name "${name}" is used more than once.`, stagePosition: g });
    } else if (key) {
      seenStageLabels.set(key, g);
    }

    const isFinal = g === groups.length - 1;
    if (!isFinal && primary.checklist.items.length === 0) {
      approval({ code: 'stage_without_items', message: `Stage "${name}" has no checklist items.`, stagePosition: g });
    }

    for (const stage of group) {
      const sla = stage.slaTargetDays;
      if (typeof sla === 'number' && Number.isFinite(sla) && sla >= 0 && !Number.isInteger(sla) && !(sla > 0 && sla < 1)) {
        approval({
          code: 'sla_not_whole_days',
          message: `Stage "${name}" has an SLA target of ${sla} days — use a whole number of days, or a value below 1 for "same day".`,
          stagePosition: g,
        });
        break;
      }
    }

    const seenItems = new Set<string>();
    primary.checklist.items.forEach((item, itemIndex) => {
      const itemKey = norm(item.label);
      if (itemKey && seenItems.has(itemKey)) {
        approval({
          code: 'item_label_duplicate',
          message: `Checklist item "${item.label.trim()}" appears more than once in stage "${name}".`,
          stagePosition: g,
          itemPosition: itemIndex,
        });
      }
      seenItems.add(itemKey);
    });

    group.forEach((stage) => {
      stage.checklist.items.forEach((item, itemIndex) => {
        if (stage !== primary) return;
        if (item.hasField && g !== 0) {
          approval({
            code: 'data_entry_outside_intake',
            message: `"${item.label.trim()}" in stage "${name}" is a data-entry item — only the first stage's items can hold typed values.`,
            stagePosition: g,
            itemPosition: itemIndex,
          });
        }
        if (item.requiredCaseFields) {
          if (item.hasField) {
            approval({
              code: 'required_fields_with_data_entry',
              message: `"${item.label.trim()}" in stage "${name}" cannot be both a data-entry item and completed from case fields.`,
              stagePosition: g,
              itemPosition: itemIndex,
            });
          }
          const unknown = item.requiredCaseFields.filter((field) => !REQUIRED_CASE_FIELDS.has(field));
          if (item.requiredCaseFields.length === 0 || unknown.length > 0) {
            approval({
              code: 'required_fields_invalid',
              message: `"${item.label.trim()}" in stage "${name}" must list one or more supported case fields${unknown.length ? ` (unsupported: ${unknown.join(', ')})` : ''}.`,
              stagePosition: g,
              itemPosition: itemIndex,
            });
          }
        }
      });
    });
  });

  // ---- unfinished workflows & completion (2026-10) -------------------------

  groups.forEach((group, g) => {
    if (isPlaceholderStageLabel(group[0].label)) {
      approval({
        code: 'placeholder_stage',
        message: `Stage "${group[0].label.trim()}" is a placeholder — define this service's own steps (rename the stage and add its checklist items) or remove it before approval.`,
        stagePosition: g,
      });
    }
  });

  if (context.requireCompletionPolicy && !context.completionPolicy) {
    approval({ code: 'completion_policy_missing', message: 'Define how a case of this service is completed (Completion section) before approving.' });
  }
  if (context.completionPolicy) {
    problems.push(...validateCompletionPolicy(context.completionPolicy, stages, 'approval').filter((p) => p.level === 'approval'));
  }

  if (context.checkUnmodifiedCopy && context.organizationTemplates) {
    const source = findUnmodifiedCopySource(
      { stages: [...stages], completionPolicy: context.completionPolicy ?? undefined, derivedFrom: context.derivedFrom, composition: context.composition ?? undefined },
      context.organizationTemplates,
      context.templateId,
    );
    if (source) {
      approval({
        code: 'unmodified_copy',
        message: `This workflow is still an unmodified copy of ${source.name}; define the service-specific steps before approval.`,
      });
    }
  }

  if (context.requireServiceAssignment && (!context.serviceTypeCodes || context.serviceTypeCodes.length === 0)) {
    approval({ code: 'service_missing', message: 'Assign this workflow to a service before approving it.' });
  }
  if (context.serviceTypeCodes && context.organizationTemplates && context.templateIsEnabled !== false) {
    for (const code of new Set(context.serviceTypeCodes)) {
      const holder = context.organizationTemplates.find(
        (t) => t.id !== context.templateId && t.isEnabled && (t.serviceTypeCodes ?? []).includes(code),
      );
      if (holder) {
        approval({
          code: 'service_taken',
          message: `${serviceName(code)} is already served by the enabled workflow "${holder.name}" — only one enabled workflow may serve a service.`,
        });
      }
    }
  }

  return problems;
}

/** Messages only — the shape the existing 400/422 `details` arrays use. */
export function problemMessages(problems: readonly WorkflowValidationProblem[]): string[] {
  return problems.map((problem) => problem.message);
}
