import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import type { ActivityContext } from './activityService';
import { generateStatement, generateReceiptOfPayment, BillingDocumentServiceError } from './billingDocumentService';
import { listPaymentRecordsForCase } from './paymentsService';

/**
 * Automatic Statement and Receipt (2026-10).
 *
 * Both documents could only be produced by a staff member pressing
 * Generate, so the copy in Documents was routinely out of date — a payment
 * recorded, a service added, and the statement still showing the old
 * figures. They are now regenerated when the facts they print change:
 *
 *   - the case order is created or changed  -> Statement (and the Receipt,
 *     if the case has a payment, since the receipt itemises the order);
 *   - a payment succeeds (manual entry or a Clover-confirmed payment)
 *     -> Statement and Receipt.
 *
 * Each document goes through the same generation path as the Generate
 * button — same renderer, same Manors letterhead, same versioning, and
 * the previous version is superseded into History (documentService.ts).
 * Neither document takes staff input the UI ever supplies, so nothing a
 * person entered is lost by regenerating. Each is attempted independently;
 * a failure is logged and the generation-failed notification already sent
 * by the document service is the staff-visible signal. Nothing here can
 * fail the payment or order change that triggered it — callers run it
 * after the response (lib/afterResponse.ts).
 */
export type AutomaticBillingTrigger = 'order_saved' | 'payment_succeeded';

export type AutomaticBillingResult = {
  statement: 'generated' | 'not_applicable' | 'failed';
  receipt: 'generated' | 'not_applicable' | 'failed';
};

export async function regenerateBillingDocuments(
  params: { caseId: string; trigger: AutomaticBillingTrigger },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<AutomaticBillingResult> {
  const result: AutomaticBillingResult = { statement: 'not_applicable', receipt: 'not_applicable' };

  try {
    await generateStatement({ caseId: params.caseId, idFactory: () => crypto.randomUUID() }, ctx, dataAdapterMode);
    result.statement = 'generated';
  } catch (error) {
    result.statement = error instanceof BillingDocumentServiceError ? 'not_applicable' : 'failed';
    logFailure('Statement', params, error);
  }

  let wantsReceipt = params.trigger === 'payment_succeeded';
  if (!wantsReceipt) {
    try {
      const payments = await listPaymentRecordsForCase(ctx.organizationId, params.caseId, dataAdapterMode);
      wantsReceipt = payments.some((p) => p.status === 'succeeded');
    } catch (error) {
      logFailure('Receipt (payment lookup)', params, error);
    }
  }
  if (wantsReceipt) {
    try {
      await generateReceiptOfPayment({ caseId: params.caseId, idFactory: () => crypto.randomUUID() }, ctx, dataAdapterMode);
      result.receipt = 'generated';
    } catch (error) {
      result.receipt = error instanceof BillingDocumentServiceError ? 'not_applicable' : 'failed';
      logFailure('Receipt of Payment', params, error);
    }
  }

  return result;
}

function logFailure(document: string, params: { caseId: string; trigger: AutomaticBillingTrigger }, error: unknown) {
  console.error(
    `[automatic billing documents] ${document} for case ${params.caseId} (${params.trigger}) was not generated:`,
    error instanceof Error ? error.message : error,
  );
}
