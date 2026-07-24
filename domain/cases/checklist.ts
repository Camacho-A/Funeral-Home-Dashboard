/**
 * Per-raw-stage required steps, ported verbatim from design/support.js's
 * CHECKLIST_BY_STAGE. Keyed by raw stage (0-7) — see stages.ts for the
 * raw/display distinction. Raw stages 0 and 1 (First Call, Payment) are
 * combined into one checklist when the case is in either.
 *
 * Phase 11 (Workflow Template Architecture): this file is now pure data,
 * read only by services/__mocks__/workflowTemplates.ts to *construct* the
 * Managed Cremations WorkflowTemplate fixture — guaranteeing the fixture
 * can never drift from what's declared here. The runtime resolution logic
 * that used to live in this file (buildChecklist, buildIntakeFieldValues)
 * moved to domain/workflow/resolveChecklist.ts and resolveIntake.ts, which
 * operate on a case's own workflowSnapshot instead of these hardcoded
 * constants — see docs/adr/ADR-006-workflow-template-architecture.md.
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
    'Payment collected',
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

/**
 * Phase 19A (Secure Payment Architecture): no checklist item label ever
 * triggers password-style masking anymore — "Payment collected" (see
 * CHECKLIST_BY_RAW_STAGE[0] above) replaced the old "Cardholder name, card
 * number, exp, CVV & billing zip code" data-entry item, which used to be a
 * hasField/isPasswordField text box writing raw payment data straight to
 * Case.fieldValues[8] from Case Detail — a leak path entirely independent
 * of the New Case intake form (see domain/workflow/resolveIntake.ts's own
 * Phase 19A comment for the intake-side half of this fix). Kept as a named
 * export, still matched against every label the same way, so a future
 * password-shaped checklist item (if one is ever legitimately needed) is
 * still masked by default — it just never matches "card"/"cvv" wording,
 * since that wording no longer describes a checklist item anywhere.
 */
export const PASSWORD_FIELD_PATTERN = /card|cvv/i;

/**
 * First Call & Payment is the one stage whose checklist items are data-entry
 * fields, marked done by having a value rather than by clicking — matching
 * design/support.js's `hasField = stageIdx === 0` exactly, including its
 * narrow raw-stage-0-only check (a case literally at raw stage 1 would not
 * get field-style items — this never happens in practice, since no case in
 * the prototype's seed data rests at raw stage 1, but the behavior is
 * preserved faithfully rather than "fixed" speculatively). Read only by the
 * fixture builder now — each raw stage's ChecklistItemTemplate.hasField is
 * set from this at fixture-construction time (see
 * services/__mocks__/workflowTemplates.ts), not recomputed per-case.
 *
 * Phase 19A: "Payment collected" is a deliberate, permanent exception —
 * even within the First Call & Payment stage, it's a plain checkbox
 * confirmation (hasField: false), never a free-text field, so there is no
 * data-entry box on Case Detail for a payment value to ever be typed into.
 * See services/__mocks__/workflowTemplates.ts's buildChecklistItems, the
 * one caller that applies this exception.
 */
export function isFirstCallStage(rawStage: number): boolean {
  return rawStage === 0;
}

export const PAYMENT_CONFIRMATION_LABEL = 'Payment collected';
