import type { Case } from '../../types/case';
import type { ChecklistItemTemplate } from '../../types/workflowTemplate';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';
import { readChecklistValue } from './checklistItemKey';
import { findStageByRawStage } from './resolveStages';

/**
 * Generic checklist resolution over a template's item list — the done/
 * locked business rules apply uniformly across any workflow template:
 * every stage defaults to all-but-the-last item done; each item locks
 * until its predecessor is done; a field-based item ("hasField") is done
 * once it has a non-empty value rather than by being clicked. What differs
 * per organization is only the item list itself (label/hasField/password),
 * supplied via `items` from the case's own workflowSnapshot — never a
 * rawStage special-case or a label regex-match.
 *
 * Behavior-preserving port of the pre-Phase-11
 * domain/cases/checklist.ts#buildChecklist, which read a hardcoded
 * CHECKLIST_BY_RAW_STAGE keyed by rawStage instead of a template. The
 * done/locked math here is unchanged; only where the item list comes from
 * has moved.
 *
 * `displayStage` identifies which stage this `items` list belongs to — it
 * is what lets isManuallyDone address checklistState by composite
 * "{displayStage}:{index}" key (see domain/workflow/checklistItemKey.ts)
 * instead of a bare index, which was ambiguous across stages and caused
 * case B2026-035 to have a later stage silently inherit an earlier
 * stage's own completed item. Deliberately scoped by displayStage, not
 * rawStage — Managed Cremations' First Call (rawStage 0) and Payment
 * (rawStage 1) are two different stages that share one displayStage (0)
 * and one identical, combined checklist; scoping by rawStage would split
 * that intentionally-shared checklist in two. Every call site must pass
 * the displayStage of the stage `items` actually came from, never the
 * case's own current `case_.rawStage` by assumption.
 */
export function resolveChecklist(
  items: ChecklistItemTemplate[],
  displayStage: number,
  case_: Case,
  options: { isPastStage?: boolean } = {},
): ChecklistItemViewModel[] {
  const { isPastStage = false } = options;
  const currentDisplayStage = case_.workflowSnapshot
    ? findStageByRawStage(case_.workflowSnapshot, case_.rawStage)?.displayStage ?? case_.rawStage
    : case_.rawStage;

  // defaultDone is NOT part of the B2026-035 integrity fix and was
  // deliberately left unchanged — it operates purely on `index` within
  // this one `items` list and never touches `checklistState`, so it was
  // never the mechanism behind the cross-stage collision (see
  // domain/workflow/checklistItemKey.ts's own doc comment for the actual
  // root cause). TODO(workflow semantics, separate from this fix): a
  // non-gating item's "done" here is "no explicit false," not a verified
  // true — a pre-existing, long-standing tradeoff (it's also what lets a
  // historical-import case advance multiple stages in one reconciliation
  // call without every non-gating item having been explicitly clicked).
  // Worth a dedicated review of whether that's still the right default,
  // but that's a workflow-semantics decision, not an integrity bug, and
  // should not be mixed into this fix.
  const defaultDone = (index: number) => index < items.length - 1;
  const isManuallyDone = (index: number) =>
    readChecklistValue(case_.checklistState, displayStage, index, currentDisplayStage) ?? defaultDone(index);
  const fieldValueAt = (index: number) => (case_.fieldValues[index] ?? '').toString().trim();
  const isFieldDone = (index: number) => fieldValueAt(index).length > 0;

  // Structured Certifier data (2026-09, ADR-041): an item with
  // requiredCaseFields is done once every listed Case field is a non-empty
  // string, computed directly against structured Case data — bypassing
  // hasField/fieldValues entirely for that one item. Generic (any future
  // multi-required-field item reuses this unchanged), never a hardcoded
  // label match.
  const isRequiredCaseFieldsDone = (item: ChecklistItemTemplate) =>
    (item.requiredCaseFields ?? []).every((field) => {
      const value = case_[field as keyof Case];
      return typeof value === 'string' && value.trim().length > 0;
    });
  const isItemDone = (item: ChecklistItemTemplate, index: number): boolean =>
    item.requiredCaseFields
      ? isRequiredCaseFieldsDone(item)
      : item.hasField
        ? isFieldDone(index)
        : isManuallyDone(index);

  return items.map((item, index) => {
    const done = isPastStage || isItemDone(item, index);
    const priorDone = index === 0 ? true : isPastStage || isItemDone(items[index - 1], index - 1);
    const locked = !isPastStage && index > 0 && !priorDone;

    return {
      index,
      label: item.label,
      done,
      locked,
      hasField: item.hasField,
      fieldValue: item.hasField ? (case_.fieldValues[index] ?? '') : '',
      fieldIsPassword: Boolean(item.isPasswordField),
      isDerived: Boolean(item.requiredCaseFields),
      valueKind: item.valueKind,
      requiredCaseFields: item.requiredCaseFields,
      requiredCaseFieldValues: item.requiredCaseFields
        ? Object.fromEntries(item.requiredCaseFields.map((field) => [field, (case_[field as keyof Case] as string | null) ?? '']))
        : undefined,
    };
  });
}
