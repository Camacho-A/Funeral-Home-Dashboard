import type { PaymentRecord, PaymentRecordStatus } from '../types/payment';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Mirrors
 * lib/wixCaseMapper.ts's role for a new `paymentRecords` collection — the
 * one place a raw Wix item for it is ever touched. See
 * docs/WIX_DATA_SCHEMA.md and docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 *
 * Every field here is either server-derived (organizationId/caseId from
 * an already-authorized, already-ownership-checked request; amount/
 * currency/purpose from server-side validated input) or comes from an
 * already-signature-verified provider webhook — never a raw, unvalidated
 * client value, and never a PAN/CVV/expiration (see lib/paymentFieldGuard.ts,
 * ADR-021) — there is no field here that could hold one even if a caller
 * tried.
 */

const VALID_STATUSES: PaymentRecordStatus[] = ['pending', 'succeeded', 'failed', 'cancelled', 'refunded'];

export type WixPaymentRecordItem = {
  beaconPaymentId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  provider?: unknown;
  providerCheckoutId?: unknown;
  providerPaymentId?: unknown;
  idempotencyKey?: unknown;
  checkoutUrl?: unknown;
  status?: unknown;
  amount?: unknown;
  currency?: unknown;
  purpose?: unknown;
  cardBrand?: unknown;
  cardLast4?: unknown;
  receiptReference?: unknown;
  failureCode?: unknown;
  failureMessage?: unknown;
  createdAt?: unknown;
  paidAt?: unknown;
  updatedAt?: unknown;
};

function isValidStatus(value: unknown): value is PaymentRecordStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}

export function mapWixPaymentRecordItem(item: WixPaymentRecordItem | undefined): PaymentRecord | null {
  if (
    !item ||
    typeof item.beaconPaymentId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.provider !== 'string' ||
    typeof item.providerCheckoutId !== 'string' ||
    typeof item.idempotencyKey !== 'string' ||
    !isValidStatus(item.status) ||
    typeof item.amount !== 'number' ||
    typeof item.currency !== 'string' ||
    typeof item.purpose !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconPaymentId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    provider: item.provider,
    providerCheckoutId: item.providerCheckoutId,
    providerPaymentId: typeof item.providerPaymentId === 'string' ? item.providerPaymentId : null,
    idempotencyKey: item.idempotencyKey,
    checkoutUrl: typeof item.checkoutUrl === 'string' ? item.checkoutUrl : null,
    status: item.status,
    amount: item.amount,
    currency: item.currency,
    purpose: item.purpose,
    cardBrand: typeof item.cardBrand === 'string' ? item.cardBrand : null,
    cardLast4: typeof item.cardLast4 === 'string' ? item.cardLast4 : null,
    receiptReference: typeof item.receiptReference === 'string' ? item.receiptReference : null,
    failureCode: typeof item.failureCode === 'string' ? item.failureCode : null,
    failureMessage: typeof item.failureMessage === 'string' ? item.failureMessage : null,
    createdAt: item.createdAt,
    paidAt: typeof item.paidAt === 'string' ? item.paidAt : null,
    updatedAt: item.updatedAt,
  };
}

export function buildWixPaymentRecordData(record: PaymentRecord): WixPaymentRecordItem {
  return {
    beaconPaymentId: record.id,
    organizationId: record.organizationId,
    caseId: record.caseId,
    provider: record.provider,
    providerCheckoutId: record.providerCheckoutId,
    providerPaymentId: record.providerPaymentId,
    idempotencyKey: record.idempotencyKey,
    checkoutUrl: record.checkoutUrl,
    status: record.status,
    amount: record.amount,
    currency: record.currency,
    purpose: record.purpose,
    cardBrand: record.cardBrand,
    cardLast4: record.cardLast4,
    receiptReference: record.receiptReference,
    failureCode: record.failureCode,
    failureMessage: record.failureMessage,
    createdAt: record.createdAt,
    paidAt: record.paidAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Merges a partial update (from a verified webhook, or the checkout route
 * attaching a providerCheckoutId post-creation) onto the existing full Wix
 * item — Wix Data's updateDataItem is a full replace (see
 * lib/wixDataApi.ts), so the merge always happens here, never a bare
 * partial sent directly.
 */
export function applyPaymentRecordUpdateToWixData(
  existing: WixPaymentRecordItem,
  patch: Partial<PaymentRecord>,
): WixPaymentRecordItem {
  const next: WixPaymentRecordItem = { ...existing };

  if (patch.providerCheckoutId !== undefined) next.providerCheckoutId = patch.providerCheckoutId;
  if (patch.providerPaymentId !== undefined) next.providerPaymentId = patch.providerPaymentId;
  if (patch.checkoutUrl !== undefined) next.checkoutUrl = patch.checkoutUrl;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.cardBrand !== undefined) next.cardBrand = patch.cardBrand;
  if (patch.cardLast4 !== undefined) next.cardLast4 = patch.cardLast4;
  if (patch.receiptReference !== undefined) next.receiptReference = patch.receiptReference;
  if (patch.failureCode !== undefined) next.failureCode = patch.failureCode;
  if (patch.failureMessage !== undefined) next.failureMessage = patch.failureMessage;
  if (patch.paidAt !== undefined) next.paidAt = patch.paidAt;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;

  return next;
}
