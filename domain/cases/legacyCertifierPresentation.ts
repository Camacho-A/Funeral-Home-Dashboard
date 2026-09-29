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
 * Narrowly scoped to managed-cremations (`case_.organizationId` checked
 * explicitly) — matching on literal English text is inherently fragile,
 * appropriate only for this one specific, permanently-frozen legacy
 * artifact, never generalized into domain/workflow/resolveChecklist.ts's
 * generic engine.
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

function certifierRequiredCaseFieldValues(case_: Case): Record<string, string> {
  return { certifierName: case_.certifierName ?? '', certifierPhone: case_.certifierPhone ?? '' };
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
 * genuinely appropriate) a completion-rule upgrade:
 *
 * - If the case has NOT started using the new structured certifierName/
 *   certifierPhone fields (both null/empty — the common case for every
 *   existing legacy Case today), `done`/`locked` are left exactly as
 *   resolveChecklist already computed them (the historical, fieldValues-
 *   based rule) — a Task #7 follow-up fix must never itself flip an
 *   existing case's completion state, which would silently change
 *   workflow progression the moment it deploys. What DOES change here
 *   (2026-09 follow-up): the item stops rendering/editing the raw legacy
 *   fieldValues entry (`hasField: true`, showing whatever free text was
 *   typed under the old "Hospice or physician..." item) — that was the
 *   actual reported bug, staff typing into a box now *labeled* "Certifier
 *   Information" but which silently saved into the legacy dcContact
 *   fieldValues slot, never into `Case.certifierName`/`certifierPhone`.
 *   It now renders the same structured Name+Phone fields a v5+ Case uses,
 *   reading/writing only `Case.certifierName`/`certifierPhone` — the old
 *   fieldValues entry (if any) is left completely untouched, purely
 *   historical, never read or migrated by this change.
 * - If the case DOES already carry structured certifier data (staff have
 *   started filling in Case Detail's Certifier Information section, which
 *   is wired unconditionally regardless of template version), the item
 *   switches to the same Name+Phone `requiredCaseFields` completion rule
 *   v5 Cases use. The immediately-following item's `locked` state is
 *   recomputed to stay consistent with the new done value (mirroring what
 *   domain/workflow/resolveChecklist.ts would have computed had this been
 *   the item's real completion rule from the start).
 * - Never called with `isPastStage: true` in a way that would contradict
 *   resolveChecklist's own "a past stage is done by definition" rule — a
 *   past stage's checklist is a read-only historical record, so it keeps
 *   showing exactly what was frozen at the time (the legacy fieldValues
 *   text, if that's what the case actually had) rather than being
 *   retroactively re-presented as the new structured fields.
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
  const idx = items.findIndex((item) => item.label === LEGACY_CERTIFIER_ITEM_LABEL);
  if (idx === -1) return items;

  const result = [...items];
  if (isPastStage) {
    result[idx] = { ...items[idx], label: CERTIFIER_INFORMATION_LABEL };
    return result;
  }

  const hasStructuredCertifierData = nonEmpty(case_.certifierName) || nonEmpty(case_.certifierPhone);

  if (!hasStructuredCertifierData) {
    result[idx] = {
      ...items[idx],
      label: CERTIFIER_INFORMATION_LABEL,
      hasField: false,
      fieldValue: '',
      isDerived: true,
      requiredCaseFields: CERTIFIER_REQUIRED_CASE_FIELDS,
      requiredCaseFieldValues: certifierRequiredCaseFieldValues(case_),
    };
    return result;
  }

  const done = nonEmpty(case_.certifierName) && nonEmpty(case_.certifierPhone);
  result[idx] = {
    ...items[idx],
    label: CERTIFIER_INFORMATION_LABEL,
    done,
    hasField: false,
    fieldValue: '',
    isDerived: true,
    requiredCaseFields: CERTIFIER_REQUIRED_CASE_FIELDS,
    requiredCaseFieldValues: certifierRequiredCaseFieldValues(case_),
  };
  if (idx + 1 < result.length) {
    result[idx + 1] = { ...result[idx + 1], locked: !done };
  }
  return result;
}
