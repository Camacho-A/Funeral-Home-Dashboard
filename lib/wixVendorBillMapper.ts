import type { VendorBill, VendorBillStatus } from '../types/vendorBill';

/**
 * Phase 36 (Procurement & Accounts Payable). Mapper for the `vendorBills`
 * collection. See docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
const VALID_STATUSES: readonly VendorBillStatus[] = ['open', 'partially_paid', 'paid', 'void'];
function isStatus(v: unknown): v is VendorBillStatus {
  return typeof v === 'string' && (VALID_STATUSES as readonly string[]).includes(v);
}

export type WixVendorBillItem = {
  beaconVendorBillId?: unknown;
  organizationId?: unknown;
  billNumber?: unknown;
  supplierId?: unknown;
  purchaseOrderId?: unknown;
  billDate?: unknown;
  dueDate?: unknown;
  status?: unknown;
  goodsAmountCents?: unknown;
  additionalChargesCents?: unknown;
  totalAmountCents?: unknown;
  amountPaidCents?: unknown;
  netVarianceCents?: unknown;
  journalEntryId?: unknown;
  notes?: unknown;
  createdByStaffProfileId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function mapWixVendorBillItem(item: WixVendorBillItem | undefined): VendorBill | null {
  if (
    !item ||
    typeof item.beaconVendorBillId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.billNumber !== 'string' ||
    typeof item.supplierId !== 'string' ||
    typeof item.billDate !== 'string' ||
    typeof item.dueDate !== 'string' ||
    !isStatus(item.status) ||
    typeof item.goodsAmountCents !== 'number' ||
    typeof item.additionalChargesCents !== 'number' ||
    typeof item.totalAmountCents !== 'number' ||
    typeof item.amountPaidCents !== 'number' ||
    typeof item.netVarianceCents !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconVendorBillId,
    organizationId: item.organizationId,
    billNumber: item.billNumber,
    supplierId: item.supplierId,
    purchaseOrderId: s(item.purchaseOrderId),
    billDate: item.billDate,
    dueDate: item.dueDate,
    status: item.status,
    goodsAmountCents: item.goodsAmountCents,
    additionalChargesCents: item.additionalChargesCents,
    totalAmountCents: item.totalAmountCents,
    amountPaidCents: item.amountPaidCents,
    netVarianceCents: item.netVarianceCents,
    journalEntryId: s(item.journalEntryId),
    notes: s(item.notes),
    createdByStaffProfileId: s(item.createdByStaffProfileId),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixVendorBillData(bill: VendorBill): WixVendorBillItem {
  return {
    beaconVendorBillId: bill.id,
    organizationId: bill.organizationId,
    billNumber: bill.billNumber,
    supplierId: bill.supplierId,
    purchaseOrderId: bill.purchaseOrderId,
    billDate: bill.billDate,
    dueDate: bill.dueDate,
    status: bill.status,
    goodsAmountCents: bill.goodsAmountCents,
    additionalChargesCents: bill.additionalChargesCents,
    totalAmountCents: bill.totalAmountCents,
    amountPaidCents: bill.amountPaidCents,
    netVarianceCents: bill.netVarianceCents,
    journalEntryId: bill.journalEntryId,
    notes: bill.notes,
    createdByStaffProfileId: bill.createdByStaffProfileId,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
  };
}

export function applyVendorBillUpdateToWixData(
  existing: WixVendorBillItem,
  patch: Partial<Pick<VendorBill, 'status' | 'amountPaidCents' | 'journalEntryId' | 'notes' | 'updatedAt'>>,
): WixVendorBillItem {
  const next: WixVendorBillItem = { ...existing };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.amountPaidCents !== undefined) next.amountPaidCents = patch.amountPaidCents;
  if (patch.journalEntryId !== undefined) next.journalEntryId = patch.journalEntryId;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
