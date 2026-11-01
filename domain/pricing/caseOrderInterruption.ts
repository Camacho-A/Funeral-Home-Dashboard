/**
 * Interrupted order edits (2026-10, Phase 5A.2). The response body every
 * route uses when an unfinished case order change holds a case's order —
 * plain data, shared by route handlers and services
 * (lib/caseOrderOperationResponses.ts, services/caseServiceChangeService.ts).
 *
 * `order_needs_repair`: the change was interrupted (older than any live
 * request) — an administrator repairs it (GET /api/cases/order-operations).
 * `order_busy`: another change is being saved right now — retry shortly.
 */
export const ORDER_NEEDS_REPAIR_REASON = 'order_needs_repair';
export const ORDER_BUSY_REASON = 'order_busy';

export type CaseOrderInterruptionSummary = {
  pendingOrderId: string;
  previousOrderId: string | null;
  since: string;
  stale: boolean;
};

export function caseOrderInterruptionBody(interruption: CaseOrderInterruptionSummary, message: string): Record<string, unknown> {
  return {
    error: message,
    reason: interruption.stale ? ORDER_NEEDS_REPAIR_REASON : ORDER_BUSY_REASON,
    interruption: { pendingOrderId: interruption.pendingOrderId, previousOrderId: interruption.previousOrderId, since: interruption.since, stale: interruption.stale },
  };
}
