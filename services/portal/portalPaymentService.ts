import crypto from 'crypto';
import type { DataAdapterMode } from '../../lib/env';
import { listPaymentRecordsForCase, initiateCheckout, getPaymentRecordById } from '../paymentsService';
import { getActiveCaseOrder } from '../pricingService';
import { buildPortalPaymentView, type PortalPaymentView } from '../../domain/portal/portalPaymentView';

/**
 * Phase 29 (Family Portal & External Collaboration). A thin wrapper —
 * every payment-provider call and every write to `paymentIntegrations`/
 * `paymentRecords` still goes through `services/paymentsService.ts`
 * (specifically its own `initiateCheckout`, added alongside this file —
 * see that function's own comment); this module never imports
 * `lib/clover/cloverProvider.ts` or any other provider directly.
 *
 * The amount charged is always the case's active `CaseOrder.balanceDue`,
 * resolved server-side here — never accepted from a family-side request
 * in any form, mirroring the staff checkout route's own invariant
 * exactly (refinement #10).
 *
 * **Named, deferred gap**: `app/api/webhooks/clover/route.ts` (the
 * webhook that confirms a payment succeeded) does not yet distinguish a
 * family-initiated payment from a staff-initiated one, so it cannot emit
 * the family-facing `portal.payment.completed` activity event itself
 * today — both create the same `PaymentRecord` shape. Wiring that
 * distinction through (e.g. a `initiatedByPortalUserId` field, or a
 * family-side polling read after return) is deferred to the family-side
 * payment-return route (a later task), not silently worked around here.
 */
export class PortalPaymentServiceError extends Error {}

export async function listFamilyPaymentHistory(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<PortalPaymentView[]> {
  const records = await listPaymentRecordsForCase(organizationId, caseId, dataAdapterMode);
  return records.map(buildPortalPaymentView);
}

/** The family return page's status read — mirrors the staff-side
    `GET .../payments/[paymentId]` route's "the webhook is the only
    authoritative source of truth, the browser's own redirect is never
    trusted" discipline, minus that route's wix-mode reconciliation
    fallback (a deliberately smaller surface for this phase; the webhook
    alone is sufficient since mock mode — this codebase's only exercised
    mode today — never needs it either). Returns `null` for a payment
    that doesn't belong to this case. */
export async function getFamilyPaymentStatus(organizationId: string, caseId: string, paymentId: string, dataAdapterMode: DataAdapterMode): Promise<PortalPaymentView | null> {
  const record = await getPaymentRecordById(organizationId, paymentId, dataAdapterMode);
  if (!record || record.caseId !== caseId) return null;
  return buildPortalPaymentView(record);
}

export async function initiateFamilyCheckout(
  params: { organizationId: string; caseId: string; idempotencyKey: string; returnUrl: string; cancelUrl: string; paymentId?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ paymentId: string; checkoutUrl: string | null }> {
  const order = await getActiveCaseOrder(params.organizationId, params.caseId, dataAdapterMode);
  if (!order) {
    throw new PortalPaymentServiceError('This case has no case order yet — services must be selected first.');
  }
  if (order.balanceDue <= 0) {
    throw new PortalPaymentServiceError('This case order has no remaining balance to collect.');
  }

  // Phase 29 UI integration finding: the caller (the checkout route) needs
  // this id *before* it builds returnUrl/cancelUrl, so the family return
  // page has something to poll — mirrors the staff Clover checkout
  // route's own "generate paymentId, then embed it in the return URL"
  // sequence exactly. `params.paymentId` is optional only so this
  // service's own pre-existing unit tests (which never needed a return
  // URL to actually resolve to anything) don't have to supply one.
  const paymentId = params.paymentId ?? crypto.randomUUID();
  const result = await initiateCheckout(
    {
      organizationId: params.organizationId,
      caseId: params.caseId,
      caseOrderId: order.id,
      provider: 'clover',
      amount: order.balanceDue,
      currency: 'usd',
      purpose: 'Case order balance due',
      idempotencyKey: params.idempotencyKey,
      paymentId,
      returnUrl: params.returnUrl,
      cancelUrl: params.cancelUrl,
    },
    dataAdapterMode,
  );

  return { paymentId: result.paymentId, checkoutUrl: result.checkoutUrl };
}
