import type { Case } from '../../types/case';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';

/**
 * Legacy Certifier presentation compatibility (2026-09, ADR-041 follow-up).
 * Workflow Template version 5 (managed-cremations, live-activated) replaced
 * the free-text "Hospice or physician who will sign the DC — name & phone
 * number" checklist item with a structured "Certifier Information" item.
 * Every Case created before that activation carries a FROZEN
 * workflowSnapshot from v1-v4 that still literally contains the old label —
 * append-only by design (see docs/TEMPLATE_VERSIONING.md), and this module
 * never rewrites it. This is a presentation-only compatibility layer: it
 * relabels that one known, frozen string wherever a checklist item's label
 * is surfaced to staff, so the terminology staff see is consistent with the
 * New Case form and v5 Cases, without migrating any persisted data.
 *
 * Extended (2026-10) to cover a second, non-legacy shape: an item already
 * labelled "Certifier Information" but carrying no `requiredCaseFields`,
 * which is what live template version 6 persisted after
 * lib/wixWorkflowTemplateMapper.ts silently dropped that field while v6
 * was being derived from v5. The module name still says "legacy" for
 * continuity with its call sites; see
 * `isCertifierItemNeedingStructuredEditor` for both shapes and why a v5
 * Case is deliberately left untouched.
 *
 * Narrowly scoped to managed-cremations (`case_.organizationId` checked
 * explicitly) — matching on literal English text is inherently fragile,
 * appropriate only for these specific, permanently-frozen snapshot
 * artifacts, never generalized into
 * domain/workflow/resolveChecklist.ts's generic engine.
 *
 * `LEGACY_CERTIFIER_ITEM_LABEL` must exactly match
 * domain/cases/checklist.ts's CHECKLIST_BY_RAW_STAGE[0][6] entry — that
 * constant is what v1-v4's frozen snapshots actually persisted this label
 * from, and it can never change (see that file's own comment) — see this
 * module's own test file for a guard against the two silently drifting
 * apart.
 */
export const LEGACY_CERTIFIER_ITEM_LABEL = 'Hospice or physician who will sign the DC — name & phone number';
export const CERTIFIER_INFORMATION_LABEL = 'Certifier Information';
const CERTIFIER_REQUIRED_CASE_FIELDS = ['certifierName', 'certifierPhone'];

function nonEmpty(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Which Certifier Information items need this module to supply the
 * structured editor. Two distinct shapes, both of which reach staff with
 * no usable certifier surface:
 *
 * 1. The pre-v5 free-text item, still carrying its old label in every
 *    frozen v1-v4 snapshot (the original reason this module exists).
 * 2. (2026-10) An item ALREADY labelled "Certifier Information" but
 *    carrying no `requiredCaseFields` — the live template version 6
 *    shape. v6 was created by round-tripping v5 through
 *    lib/wixWorkflowTemplateMapper.ts, which silently dropped the field
 *    (fixed separately, in that file). Because template versions are
 *    append-only and their snapshots are frozen by design, v6 and every
 *    Case already created from it can only be repaired here, at
 *    presentation time — there is no snapshot to rewrite.
 *
 * A v5 Case is deliberately NOT matched: its snapshot already carries
 * `requiredCaseFields`, so resolveChecklist has already produced the
 * structured editor and the correct completion rule, and this module must
 * leave it entirely alone.
 */
function isCertifierItemNeedingStructuredEditor(item: ChecklistItemViewModel): boolean {
  if (item.label === LEGACY_CERTIFIER_ITEM_LABEL) return true;
  return item.label === CERTIFIER_INFORMATION_LABEL && (item.requiredCaseFields ?? []).length === 0;
}

function certifierRequiredCaseFieldValues(case_: Case): Record<string, string> {
  return { certifierName: case_.certifierName ?? '', certifierPhone: case_.certifierPhone ?? '' };
}

/**
 * Swaps an item's editing surface to the structured Name+Phone editor —
 * never the raw legacy free-text box. Deliberately does not touch
 * `done`/`locked`: callers decide those independently, since the right
 * rule differs between "viewing the current stage" (completion should
 * reflect whether staff have actually entered both fields yet) and
 * "viewing a past stage" (done-by-definition, never recomputed).
 */
function withStructuredCertifierEditor(item: ChecklistItemViewModel, case_: Case): ChecklistItemViewModel {
  return {
    ...item,
    label: CERTIFIER_INFORMATION_LABEL,
    hasField: false,
    fieldValue: '',
    isDerived: true,
    requiredCaseFields: CERTIFIER_REQUIRED_CASE_FIELDS,
    requiredCaseFieldValues: certifierRequiredCaseFieldValues(case_),
  };
}

/**
 * Label-only substitution — safe to call anywhere a checklist item's label
 * is read directly from a case's own (possibly frozen, pre-v5) snapshot,
 * with no done/locked semantics involved (e.g. domain/cases/timeline.ts's
 * past-stage "story of the case" entries, which only ever read `.label`
 * for an already-completed stage).
 */
export function presentedChecklistItemLabel(label: string, organizationId: string): string {
  return organizationId === 'managed-cremations' && label === LEGACY_CERTIFIER_ITEM_LABEL
    ? CERTIFIER_INFORMATION_LABEL
    : label;
}

/**
 * Applies the relabel to a resolved checklist item list, plus (only when
 * genuinely appropriate) a completion-rule upgrade. In every branch below,
 * the editing surface becomes the structured Name+Phone editor — never
 * the raw legacy free-text box (the actual reported bug: staff typing
 * into a box now *labeled* "Certifier Information" but which silently
 * saved into the legacy dcContact fieldValues slot, never into
 * `Case.certifierName`/`certifierPhone`). The old fieldValues entry (if
 * any) is left completely untouched, purely historical, never read or
 * migrated by this module.
 *
 * - Current stage, no structured data yet (the common case for every
 *   existing legacy Case today): `done`/`locked` are left exactly as
 *   resolveChecklist already computed them (the historical, fieldValues-
 *   based rule) — a presentation fix must never itself flip an existing
 *   case's completion state, which would silently change workflow
 *   progression the moment it deploys.
 * - Current stage, structured data already present (staff have started
 *   filling in Case Detail's Certifier Information section, which is
 *   wired unconditionally regardless of template version): the item
 *   switches to the same Name+Phone `requiredCaseFields` completion rule
 *   v5 Cases use. The immediately-following item's `locked` state is
 *   recomputed to stay consistent with the new done value (mirroring what
 *   domain/workflow/resolveChecklist.ts would have computed had this been
 *   the item's real completion rule from the start).
 * - Past stage (2026-09, second follow-up — Task #7 reopened a second
 *   time): `done`/`locked` are left completely untouched — resolveChecklist
 *   already computed `done: true` (a past stage is done by definition)
 *   and `locked: false` for every item in this view, and neither is
 *   recomputed here, so historical workflow progression can never be
 *   reopened, relocked, or reinterpreted by this change. What DOES change:
 *   the editing surface is *always* the live structured Name+Phone editor
 *   here too. Certifier Name/Phone are current Case data, not part of the
 *   frozen stage snapshot — staff revisiting an earlier stage still need
 *   to be able to complete or correct them, exactly as Case Information
 *   already lets them do from Case Detail's main view. The structured
 *   fields start blank on a case where nobody has entered them yet
 *   (`Case.certifierName`/`certifierPhone` are genuinely null) — the old
 *   fieldValues text is never guessed into them.
 *
 * A no-op (returns `items` unchanged) for any organization other than
 * managed-cremations, and for any item list that doesn't contain the
 * legacy label at all (every v5+ Case, where the persisted label is
 * already "Certifier Information").
 */
export function applyLegacyCertifierPresentation(
  items: ChecklistItemViewModel[],
  case_: Case,
  isPastStage: boolean,
): ChecklistItemViewModel[] {
  if (case_.organizationId !== 'managed-cremations') return items;
  const idx = items.findIndex(isCertifierItemNeedingStructuredEditor);
  if (idx === -1) return items;

  const result = [...items];

  if (isPastStage) {
    result[idx] = withStructuredCertifierEditor(items[idx], case_);
    return result;
  }

  const hasStructuredCertifierData = nonEmpty(case_.certifierName) || nonEmpty(case_.certifierPhone);

  if (!hasStructuredCertifierData) {
    result[idx] = withStructuredCertifierEditor(items[idx], case_);
    return result;
  }

  const done = nonEmpty(case_.certifierName) && nonEmpty(case_.certifierPhone);
  result[idx] = { ...withStructuredCertifierEditor(items[idx], case_), done };
  if (idx + 1 < result.length) {
    result[idx + 1] = { ...result[idx + 1], locked: !done };
  }
  return result;
}
