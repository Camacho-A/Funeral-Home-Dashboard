import type { Case } from '../../types/case';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';

/**
 * Per-raw-stage required steps, ported verbatim from design/support.js's
 * CHECKLIST_BY_STAGE. Keyed by raw stage (0-7) — see stages.ts for the
 * raw/display distinction. Raw stages 0 and 1 (First Call, Payment) are
 * combined into one checklist when the case is in either.
 */
const CHECKLIST_BY_RAW_STAGE: Record<number, string[]> = {
  0: [
    'Name of deceased',
    'Place of death — name, address & phone number',
    'Date of birth',
    'Weight',
    'Date of death',
    'Time of death',
    'Hospice or physician who will sign the DC — name & phone number',
    'Family contact — name, phone number & email',
    'Cardholder name, card number, exp, CVV & billing zip code',
  ],
  1: [
    'Credit card payment collected by phone',
    'Payment receipt sent — confirms cleared to dispatch',
  ],
  2: ['Jotform application completed'],
  3: [
    'EDRS submitted & sent to doctor',
    'Cause of death entered',
    'Hardsave for state approval if not an online doctor',
  ],
  4: ['Permit sent to crematory', 'Authorization of release sent to crematory'],
  5: ['DC application filled out', 'Sent day before ashes arrive'],
  6: [
    'Ashes picked up (Tue/Fri)',
    'Tag photo taken',
    'Tag/name/cert cross-checked',
    'Labels made',
    'Transferred to urn',
    'Family contacted — ashes ready for pickup',
  ],
  7: ['Family picked up ashes'],
};

export function getChecklistLabels(rawStage: number): string[] {
  if (rawStage <= 1) return [...CHECKLIST_BY_RAW_STAGE[0], ...CHECKLIST_BY_RAW_STAGE[1]];
  return CHECKLIST_BY_RAW_STAGE[rawStage] ?? [];
}

const PASSWORD_FIELD_PATTERN = /card|cvv/i;

/**
 * First Call & Payment is the one stage whose checklist items are data-entry
 * fields, marked done by having a value rather than by clicking — matching
 * design/support.js's `hasField = stageIdx === 0` exactly, including its
 * narrow raw-stage-0-only check (a case literally at raw stage 1 would not
 * get field-style items — this never happens in practice, since no case in
 * the prototype's seed data rests at raw stage 1, but the behavior is
 * preserved faithfully rather than "fixed" speculatively).
 */
export function isFirstCallStage(rawStage: number): boolean {
  return rawStage === 0;
}

/**
 * Builds the checklist for whatever raw stage is passed in — the case's
 * current stage in the common case, or a past raw stage when the caller
 * (domain/cases/viewModel.ts) is rendering a read-only historical view.
 * Every item's `done`/`locked` state is derived from `case_`, never stored
 * separately — see docs/adr/ADR-004-domain-layer.md.
 *
 * `isPastStage` is the fix for a real bug: `case_.checklistState`/
 * `fieldValues` are only ever written for whatever stage the case is
 * *currently* in — a stage the case has since advanced beyond has no
 * checklistState/fieldValues entries of its own (they were never needed,
 * since the case moved on) and so read as "incomplete" by the plain
 * per-item logic below. But a case cannot reach a later stage without
 * having completed the earlier one — that's the whole point of
 * transitions.ts's stage-advancement rule — so a past stage is complete by
 * definition, regardless of what checklistState happens to hold. The
 * caller (buildCaseViewModel) sets this whenever the requested rawStage is
 * strictly behind the case's actual current stage.
 */
export function buildChecklist(
  case_: Case,
  rawStage: number,
  options: { isPastStage?: boolean } = {},
): ChecklistItemViewModel[] {
  const { isPastStage = false } = options;
  const labels = getChecklistLabels(rawStage);
  const hasField = isFirstCallStage(rawStage);

  // Every stage defaults to "all but the last item done" so the final,
  // most consequential action always requires an explicit check.
  const defaultDone = (index: number) => index < labels.length - 1;
  const isManuallyDone = (index: number) => case_.checklistState[index] ?? defaultDone(index);
  const fieldValueAt = (index: number) => (case_.fieldValues[index] ?? '').toString().trim();
  const isFieldDone = (index: number) => fieldValueAt(index).length > 0;

  return labels.map((label, index) => {
    const done = isPastStage || (hasField ? isFieldDone(index) : isManuallyDone(index));
    const priorDone =
      index === 0
        ? true
        : isPastStage || (hasField ? isFieldDone(index - 1) : isManuallyDone(index - 1));
    const locked = !isPastStage && index > 0 && !priorDone;

    return {
      index,
      label,
      done,
      locked,
      hasField,
      // Only meaningful when hasField is true — fieldValues is indexed per
      // the First Call & Payment stage's own field layout, so surfacing it
      // for a different stage's (checkbox-only) item would be a semantically
      // meaningless index collision, not real data.
      fieldValue: hasField ? (case_.fieldValues[index] ?? '') : '',
      fieldIsPassword: PASSWORD_FIELD_PATTERN.test(label),
    };
  });
}
