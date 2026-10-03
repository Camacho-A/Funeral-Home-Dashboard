import type { Case } from '../../types/case';
import type { ChecklistItemTemplate } from '../../types/workflowTemplate';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';
import { readChecklistValue } from './checklistItemKey';

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

  // Checklist default-done fix (2026-10). Previously every item except a
  // stage's last defaulted to "done" the moment a case entered that stage
  // — a freshly-entered stage's checklist showed most of its items
  // pre-checked, including the first one, with nothing actually clicked.
  // That was deliberate at the time (see this file's own git history) so
  // that a stage only truly gated advancement on its last item, which is
  // also what let a historical-import case jump forward through several
  // stages in one `workflowReconciliationService.ts` call without every
  // non-gating item being explicitly set. Changed, by explicit product
  // decision: every item (manual, field-backed, or requiredCaseFields)
  // now requires actual, explicit evidence of completion — "no explicit
  // false" is no longer treated as "done." A historical-import case must
  // now carry (or reconciliation's own form/payment overlays must supply)
  // real completion for every non-gating item, the same as any other
  // case, to advance past a stage.
  const defaultDone = (_index: number) => false;
  const isManuallyDone = (index: number) => readChecklistValue(case_.checklistState, displayStage, index) ?? defaultDone(index);
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
