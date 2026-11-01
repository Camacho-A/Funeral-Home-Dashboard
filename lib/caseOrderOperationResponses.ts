import { NextResponse } from 'next/server';
import { CaseOrderInterruptedError, CaseOrderJournalUnavailableError } from '@/services/pricingService';
import { caseOrderInterruptionBody } from '@/domain/pricing/caseOrderInterruption';

export { caseOrderInterruptionBody, ORDER_BUSY_REASON, ORDER_NEEDS_REPAIR_REASON } from '@/domain/pricing/caseOrderInterruption';

/**
 * Interrupted order edits (2026-10, Phase 5A.2). The one translation of the
 * order-operation refusals into HTTP, shared by every route that changes a
 * case order:
 *  - CaseOrderInterruptedError → 409 `order_needs_repair` / `order_busy`
 *    (domain/pricing/caseOrderInterruption.ts). Nothing was written.
 *  - CaseOrderJournalUnavailableError → 503 `journal_unavailable`. Nothing
 *    was written.
 * Returns null for any other error.
 */
export function caseOrderOperationErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof CaseOrderInterruptedError) {
    return NextResponse.json(caseOrderInterruptionBody(error.interruption, error.message), { status: 409 });
  }
  if (error instanceof CaseOrderJournalUnavailableError) {
    return NextResponse.json({ error: error.message, reason: 'journal_unavailable' }, { status: 503 });
  }
  return null;
}
