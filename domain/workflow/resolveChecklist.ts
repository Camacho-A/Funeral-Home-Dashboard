import type { Case } from '../../types/case';
import { checklistCompletionInfo, isChecklistAutomationEnabled } from './checklistAutomation';
import type { ChecklistItemTemplate } from '../../types/workflowTemplate';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';
import { readChecklistValue } from './checklistItemKey';
import { retiredChecklistIndices } from '../organization/checklistRetirement';
import { presentedChecklistLabel } from '../organization/checklistRelabel';
import { applyMedicalExaminerVariant } from '../organization/medicalExaminerWorkflow';
import { isTrueEarlierStageStatusEnabled } from './earlierStages';
import { findCaseFieldForChecklistIndex } from './resolveIntake';
import { PAYMENT_CONFIRMATION_LABEL, getChecklistLabels } from '../cases/checklist';
import { CERTIFIER_INFORMATION_LABEL, LEGACY_CERTIFIER_ITEM_LABEL } from '../cases/legacyCertifierPresentation';

/** The frozen label every snapshot persists for the Family Contact item.
    Defined from the same constant viewModel.ts derives its own from. */
const FAMILY_CONTACT_ITEM_LABEL = getChecklistLabels(0)[7];

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

  /**
   * Derived intake items (2026-10). Certifier and Family Contact are
   * satisfied by the case's own structured fields.
   *
   * These rules used to live ONLY in the view model's presentation
   * overlays (legacyCertifierPresentation.ts,
   * applyFamilyContactPresentation), which meant the checklist a staff
   * member SAW and the checklist reconciliation EVALUATED disagreed:
   * B2026-038 showed every intake item ticked while
   * `computeFirstIncompleteRawStage` still read items 6 and 7 as
   * outstanding, so the case sat on the intake stage with nothing left to
   * click. Completion now has one source of truth, here, and the overlays
   * are left to do what they are for — labels, rows and editors.
   *
   * Matched on canonical labels, never indices: a frozen snapshot can
   * carry either the legacy or the current certifier label, and neither
   * carries `requiredCaseFields` at all.
   */
  const nonEmpty = (value: string | null | undefined) => typeof value === 'string' && value.trim() !== '';
  const isCertifierItem = (label: string) =>
    label === CERTIFIER_INFORMATION_LABEL || label === LEGACY_CERTIFIER_ITEM_LABEL;
  const isCertifierKnown = nonEmpty(case_.certifierName) && nonEmpty(case_.certifierPhone);
  // Email is deliberately not required — see viewModel.ts's own comment.
  const isFamilyContactKnown = nonEmpty(case_.nextOfKinName) && nonEmpty(case_.nextOfKinPhone);
  /**
   * Satisfied by the canonical Case column, REGARDLESS of `hasField`
   * (2026-10).
   *
   * Manors' First Call (rawStage 0) and Payment (rawStage 1) are two
   * stages that share one displayStage, one label, and one identical
   * 11-item checklist — but rawStage 1's copies all carry
   * `hasField: false`. Keying this off `hasField` therefore satisfied the
   * items at rawStage 0 and left the very same items, under the very same
   * composite keys, unsatisfiable at rawStage 1: the case advanced
   * 0 -> 1 and then stalled forever on boxes that already read as ticked.
   * That is the "not moving to the next step after the last box" report.
   *
   * `canonicalFallbackValue` is already tightly scoped — intake stage
   * only, and only where the index maps to ONE unambiguous Case field
   * with a real value — so an action item like "Payment collected", which
   * maps to no Case field at all, is untouched by this and still requires
   * somebody to do it.
   */
  const isSatisfiedByCaseData = (index: number) => canonicalFallbackValue(case_, displayStage, index) !== '';

  /**
   * Certifier fax (2026-10, template v7). The label-based Name + Phone rule
   * above exists for snapshots whose Certifier item carries no
   * `requiredCaseFields` (v1-v4's free-text item, v6's stripped item). An
   * item that DOES declare its fields is judged by exactly those fields —
   * otherwise a v7 item requiring Name + FAX would still be satisfied by a
   * phone number. For a v5 snapshot (Name + Phone declared) the outcome is
   * identical either way, so no existing case's completion changes.
   */
  const isUndeclaredCertifierItem = (item: ChecklistItemTemplate) =>
    isCertifierItem(item.label) && (item.requiredCaseFields ?? []).length === 0;

  const isItemDone = (item: ChecklistItemTemplate, index: number): boolean =>
    item.label === PAYMENT_CONFIRMATION_LABEL && isPaymentConfirmed
      ? true
      : isUndeclaredCertifierItem(item) && isCertifierKnown
        ? true
        : item.label === FAMILY_CONTACT_ITEM_LABEL && isFamilyContactKnown
          ? true
          : isSatisfiedByCaseData(index)
            ? true
            :
    item.requiredCaseFields
      ? isRequiredCaseFieldsDone(item)
      : item.hasField
        ? isFieldDone(index)
        : isManuallyDone(index);

  /**
   * Medical Examiner variant (2026-10). Applied BEFORE retirement and
   * before any done/locked maths, so everything below operates on the
   * items this case actually presents. A standard case is returned
   * untouched, so the normal workflow never routes through this.
   */
  const presentedItems = applyMedicalExaminerVariant(
    items,
    case_.organizationId,
    displayStage,
    case_.isMedicalExaminerCase === true,
  );

  // Retired items (2026-10) stay in the template at their original index —
  // `checklistState` is keyed by position, so removing one would re-point
  // every later stored key — but they are not rendered and do not gate the
  // stage. The ORIGINAL index travels on each view model below, so stored
  // state keeps resolving to exactly the item it always meant.
  const retired = retiredChecklistIndices(case_.organizationId, displayStage, presentedItems);
  // The item's OWN `index` is the identity every stored checklistState key
  // resolves against — never its position in this array, which the ME
  // variant can legitimately reorder.
  const visible = presentedItems
    .map((item) => ({ item, index: item.index }))
    .filter(({ index }) => !retired.has(index));

  const attributionEnabled = isChecklistAutomationEnabled(case_.organizationId);
  // A stage the case has moved beyond shows its TRUE status (2026-10) where
  // the organization has it (isTrueEarlierStageStatusEnabled — Manors). It
  // used to read as fully done because the case had advanced — so a case
  // moved on without its steps checked (the Dashboard's bulk advance, a
  // historical import, or a Medical Examiner reclassification after the
  // doctor steps were ticked) looked complete while the completion that
  // actually matters (e.g. Send to Crematory's Workflow 2) said otherwise.
  // Elsewhere an earlier stage still reads as complete, unchanged.
  const pastStageReadsDone = isPastStage && !isTrueEarlierStageStatusEnabled(case_.organizationId);
  return visible.map(({ item, index }, position) => {
    const done = pastStageReadsDone || isItemDone(item, index);
    // Locking follows the previous VISIBLE item, so retiring one never
    // leaves the next item permanently blocked behind something hidden.
    // An earlier stage is never locked: staff complete or correct its
    // steps in any order.
    const previous = position === 0 ? null : visible[position - 1];
    const priorDone = previous === null ? true : isItemDone(previous.item, previous.index);
    const locked = !isPastStage && position > 0 && !priorDone;

    return {
      index,
      // Display wording only (checklistRelabel.ts) — every label-matching
      // rule above has already run against the stored label.
      label: presentedChecklistLabel(case_.organizationId, displayStage, item),
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
      completion:
        done && attributionEnabled
          ? checklistCompletionInfo(case_, displayStage, index, item.hasField || Boolean(item.requiredCaseFields))
          : undefined,
      valueKind: item.valueKind,
      requiredCaseFields: item.requiredCaseFields,
      requiredCaseFieldValues: item.requiredCaseFields
        ? Object.fromEntries(item.requiredCaseFields.map((field) => [field, (case_[field as keyof Case] as string | null) ?? '']))
        : undefined,
    };
  });
}
