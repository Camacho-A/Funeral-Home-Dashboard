import { STAGES, LAST_DISPLAY_STAGE } from './stages';

/**
 * Target days-in-stage before a case is considered overdue, ported from
 * design/support.js's DEFAULT_SLA_TARGET. "Completed" has no target — it's
 * the terminal state. Per-organization SLA overrides are described in
 * docs/BUSINESS_RULES.md as a future admin capability, but no screen in the
 * approved V1 scope actually edits them, so this module only exposes the
 * defaults — not building an override mechanism ahead of a real consumer.
 */
const DEFAULT_SLA_TARGET_DAYS: Partial<Record<(typeof STAGES)[number], number>> = {
  'First Call & Payment': 0.25,
  'Jotform Application': 1,
  'EDRS & Doctor / Cause of Death': 3,
  'Permit & Authorization Sent to Crematory': 1,
  'DC Application Sent': 2,
  'Ready for Pickup / Contact Family': 4,
};

export function getSlaTargetDays(displayStage: number): number | null {
  const label = STAGES[displayStage];
  return DEFAULT_SLA_TARGET_DAYS[label] ?? null;
}

export function formatSlaTarget(targetDays: number | null): string {
  if (targetDays == null) return '—';
  return targetDays < 1 ? 'same day' : `${targetDays}d`;
}

export function isOverdue(displayStage: number, daysWaitingInStage: number): boolean {
  const target = getSlaTargetDays(displayStage);
  return target != null && daysWaitingInStage > target && displayStage < LAST_DISPLAY_STAGE;
}
