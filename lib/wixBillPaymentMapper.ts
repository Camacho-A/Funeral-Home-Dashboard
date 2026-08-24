import type { BillPayment, BillPaymentMethod } from '../types/billPayment';

/**
 * Phase 36 (Procurement & Accounts Payable). Mapper for the `billPayments`
 * collection — insert-only (a payment is a fact; corrected by reversing its
 * journal entry, never edited). See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
const VALID_METHODS: readonly BillPaymentMethod[] = ['check', 'ach', 'card', 'cash', 'other'];
function isMethod(v: unknown): v is BillPaymentMethod {
  return typeof v === 'string' && (VALID_METHODS as readonly string[]).includes(v);
}

export type WixBillPaymentItem = {
  beaconBillPaymentId?: unknown;
  organizationId?: unknown;
  vendorBillId?: unknown;
  supplierId?: unknown;
  amountCents?: unknown;
  paymentDate?: unknown;
  method?: unknown;
  referenceNumber?: unknown;
  cashAccountNumber?: unknown;
  journalEntryId?: unknown;
  notes?: unknown;
  createdByStaffProfileId?: unknown;
  createdAt?: unknown;
};

const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function mapWixBillPaymentItem(item: WixBillPaymentItem | undefined): BillPayment | null {
  if (
    !item ||
    typeof item.beaconBillPaymentId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.vendorBillId !== 'string' ||
    typeof item.supplierId !== 'string' ||
    typeof item.amountCents !== 'number' ||
    typeof item.paymentDate !== 'string' ||
    !isMethod(item.method) ||
    typeof item.cashAccountNumber !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconBillPaymentId,
    organizationId: item.organizationId,
    vendorBillId: item.vendorBillId,
    supplierId: item.supplierId,
    amountCents: item.amountCents,
    paymentDate: item.paymentDate,
    method: item.method,
    referenceNumber: s(item.referenceNumber),
    cashAccountNumber: item.cashAccountNumber,
    journalEntryId: s(item.journalEntryId),
    notes: s(item.notes),
    createdByStaffProfileId: s(item.createdByStaffProfileId),
    createdAt: item.createdAt,
  };
}

export function buildWixBillPaymentData(payment: BillPayment): WixBillPaymentItem {
  return {
    beaconBillPaymentId: payment.id,
    organizationId: payment.organizationId,
    vendorBillId: payment.vendorBillId,
    supplierId: payment.supplierId,
    amountCents: payment.amountCents,
    paymentDate: payment.paymentDate,
    method: payment.method,
    referenceNumber: payment.referenceNumber,
    cashAccountNumber: payment.cashAccountNumber,
    journalEntryId: payment.journalEntryId,
    notes: payment.notes,
    createdByStaffProfileId: payment.createdByStaffProfileId,
    createdAt: payment.createdAt,
  };
}
