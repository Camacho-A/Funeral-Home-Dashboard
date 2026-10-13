import type { Case } from '../../types/case';
import type { ChecklistItemTemplate } from '../../types/workflowTemplate';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';
import { readChecklistValue } from './checklistItemKey';
import { retiredChecklistIndices } from '../organization/checklistRetirement';
import { findCaseFieldForChecklistIndex } from './resolveIntake';
import { PAYMENT_CONFIRMATION_LABEL } from '../cases/checklist';

/**
 * The placeholder `services/casesService.ts#create` and `POST /api/cases`
 * store for an optional Case field that was never supplied. It is an
 * "unknown" marker, never a real value, so it must read as blank here —
 * matching `domain/cases/viewModel.ts`'s own handling of it.
 */
const UNKNOWN_CASE_FIELD_PLACEHOLDER = '—';

/**
 * The display stage whose checklist the intake template's own
 * `checklistItemIndex` values address.
 *
 * `Case.fieldValues` is keyed by a BARE item index, not by the composite
 * `{displayStage}:{index}` key `checklistState` uses — so an index is only
 * unambiguous while exactly one stage owns field-backed items. That holds:
 * the intake form populates the first stage's checklist, and the canonical
 * fallback below is deliberately confined to it rather than being applied
 * to any stage that happens to have an item at the same local index.
 */
const INTAKE_DISPLAY_STAGE = 0;

/**
 * Automated-intake checklist fix (2026-10). The value a field-backed
 * intake item DISPLAYS, resolved canonical-field-aware.
 *
 * `Case.fieldValues` keeps absolute precedence: a value a human typed into
 * the checklist is what shows, always. The fallback only fills in an entry
 * that is genuinely absent, by reading the structured Case field the
 * intake template says that item maps to.
 *
 * WHY THIS IS NEEDED. A case created through `POST /api/cases` — which is
 * every webhook-created First Call case, and the New Case modal — persists
 * the decedent's name, date of birth, weight, date/time of death and place
 * of death as canonical Case COLUMNS, and never writes `fieldValues`. The
 * checklist read only `fieldValues`, so those items rendered blank on a
 * case whose data was in fact fully present (live example: B2026-037 held
 * decedentName "ANGELICA CAMACHO", weight "136", dateOfBirth "02/02/1990"
 * with `fieldValues: {}`). The canonical column is the source of truth;
 * this makes the checklist read it instead of inventing a second one.
 *
 * DISPLAY ONLY — this is NOT consulted by `isFieldDone`. Completion still
 * requires a real `fieldValues` entry, so nothing is auto-completed and no
 * stage self-advances: `services/workflowReconciliationService.ts` calls
 * this same `resolveChecklist`, and its advancement decisions are
 * unchanged by this function existing.
 *
 * Ambiguous indices resolve to null and get no fallback —
 * `findCaseFieldForChecklistIndex` returns null when one index maps to
 * more than one Case field (Family Contact's shared name/phone/email
 * index), which already has its own structured editor.
 */
function canonicalFallbackValue(case_: Case, displayStage: number, index: number): string {
  if (displayStage !== INTAKE_DISPLAY_STAGE) return '';
  if (!case_.workflowSnapshot) return '';

  const caseField = findCaseFieldForChecklistIndex(case_.workflowSnapshot.intake, index);
  if (!caseField) return '';

  const value = case_[caseField as keyof Case];
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  return trimmed === '' || trimmed === UNKNOWN_CASE_FIELD_PLACEHOLDER ? '' : trimmed;
}

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
  /**
   * Arrangement-first intake fix (2026-10). A field-backed intake item is
   * done when the information it asks for actually exists — whether a
   * human typed it into the checklist (`fieldValues`) or it arrived on
   * the canonical Case column from a Jotform submission.
   *
   * WHY THIS CHANGED. `POST /api/cases` — which is every webhook-created
   * case — writes the decedent's name, dates, place and time of death to
   * canonical Case COLUMNS and never to `fieldValues`. Completion read
   * only `fieldValues`, so a case created from the Arrangement Form
   * DISPLAYED all its intake answers (via canonicalFallbackValue, which
   * has always read the column) while every one of those items sat
   * unchecked, with no action a staff member could take to satisfy them
   * other than retyping values already on screen. Live example:
   * B2026-038, created 2026-10-12 from a real Arrangement submission.
   *
   * Scope is deliberately narrow and unchanged from the display
   * fallback's own: intake stage only, `hasField` items only, and only
   * where `findCaseFieldForChecklistIndex` resolves ONE unambiguous Case
   * field. An action item ("Payment collected"), a document item, or a
   * confirmation item has no `hasField` and is untouched — data being
   * present never implies somebody did something.
   */
  const isFieldDone = (index: number) =>
    fieldValueAt(index).length > 0 || canonicalFallbackValue(case_, displayStage, index) !== '';

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
  /**
   * Payment completion (2026-10). "Payment collected" reflects the case's
   * own payment status, not a separate box someone has to remember.
   *
   * It was already ticked by `markCasePaidIfVerified` when a payment is
   * recorded through the payments API — but a staff member who simply
   * sets Payment to "Paid in full" on Case Information makes an ordinary
   * field edit that never reaches that service, leaving the box
   * unchecked while the case plainly says it is paid. Deriving it removes
   * that whole class of disagreement: however the case came to be paid,
   * the item agrees.
   *
   * Identified by the canonical label, never a hardcoded index — the same
   * technique domain/cases/paymentChecklist.ts already uses, so a
   * template that places the item elsewhere, or omits it, still works.
   * Only this one item derives; "Payment receipt sent" remains a real
   * action somebody performs.
   */
  const isPaymentConfirmed = case_.paymentStatus === 'paid_in_full';
  const isItemDone = (item: ChecklistItemTemplate, index: number): boolean =>
    item.label === PAYMENT_CONFIRMATION_LABEL && isPaymentConfirmed
      ? true
      :
    item.requiredCaseFields
      ? isRequiredCaseFieldsDone(item)
      : item.hasField
        ? isFieldDone(index)
        : isManuallyDone(index);

  // Retired items (2026-10) stay in the template at their original index —
  // `checklistState` is keyed by position, so removing one would re-point
  // every later stored key — but they are not rendered and do not gate the
  // stage. The ORIGINAL index travels on each view model below, so stored
  // state keeps resolving to exactly the item it always meant.
  const retired = retiredChecklistIndices(case_.organizationId, displayStage, items);
  const visible = items.map((item, index) => ({ item, index })).filter(({ index }) => !retired.has(index));

  return visible.map(({ item, index }, position) => {
    const done = isPastStage || isItemDone(item, index);
    // Locking follows the previous VISIBLE item, so retiring one never
    // leaves the next item permanently blocked behind something hidden.
    const previous = position === 0 ? null : visible[position - 1];
    const priorDone = previous === null ? true : isPastStage || isItemDone(previous.item, previous.index);
    const locked = !isPastStage && position > 0 && !priorDone;

    return {
      index,
      label: item.label,
      done,
      locked,
      hasField: item.hasField,
      // `fieldValues` first (a typed value always wins), then the mapped
      // canonical Case column. Never both, never a third source.
      fieldValue: item.hasField
        ? fieldValueAt(index) !== ''
          ? (case_.fieldValues[index] ?? '')
          : canonicalFallbackValue(case_, displayStage, index)
        : '',
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
