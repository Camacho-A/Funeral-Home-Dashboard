import type { Case } from '../../types/case';
import type { ChecklistItemTemplate } from '../../types/workflowTemplate';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';

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
 */
export function resolveChecklist(
  items: ChecklistItemTemplate[],
  case_: Case,
  options: { isPastStage?: boolean } = {},
): ChecklistItemViewModel[] {
  const { isPastStage = false } = options;

  const defaultDone = (index: number) => index < items.length - 1;
  const isManuallyDone = (index: number) => case_.checklistState[index] ?? defaultDone(index);
  const fieldValueAt = (index: number) => (case_.fieldValues[index] ?? '').toString().trim();
  const isFieldDone = (index: number) => fieldValueAt(index).length > 0;

  return items.map((item, index) => {
    const done = isPastStage || (item.hasField ? isFieldDone(index) : isManuallyDone(index));
    const priorDone =
      index === 0
        ? true
        : isPastStage || (item.hasField ? isFieldDone(index - 1) : isManuallyDone(index - 1));
    const locked = !isPastStage && index > 0 && !priorDone;

    return {
      index,
      label: item.label,
      done,
      locked,
      hasField: item.hasField,
      fieldValue: item.hasField ? (case_.fieldValues[index] ?? '') : '',
      fieldIsPassword: Boolean(item.isPasswordField),
    };
  });
}
