import type { VendorBillLineItem, VendorBillLineKind } from '../types/vendorBillLineItem';

/**
 * Phase 36 (Procurement & Accounts Payable). Mapper for the first-class
 * `vendorBillLineItems` collection — insert-only (bill lines are immutable
 * once written; a bill is corrected by void/reversal, never line edits).
 * `lineKind` defaults to `'goods'` when absent. See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
function isLineKind(v: unknown): v is VendorBillLineKind {
  return v === 'goods' || v === 'expense';
}

export type WixVendorBillLineItemItem = {
  beaconVendorBillLineItemId?: unknown;
  organizationId?: unknown;
  vendorBillId?: unknown;
  lineNumber?: unknown;
  lineKind?: unknown;
  receiptMovementId?: unknown;
  purchaseOrderLineItemId?: unknown;
  productId?: unknown;
  productDescriptionSnapshot?: unknown;
  quantityBilled?: unknown;
  grniValueCents?: unknown;
  billedUnitCostCents?: unknown;
  varianceCents?: unknown;
  expenseAccountNumber?: unknown;
  expenseDescription?: unknown;
  lineAmountCents?: unknown;
  createdAt?: unknown;
};

const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function mapWixVendorBillLineItemItem(item: WixVendorBillLineItemItem | undefined): VendorBillLineItem | null {
  if (
    !item ||
    typeof item.beaconVendorBillLineItemId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.vendorBillId !== 'string' ||
    typeof item.lineNumber !== 'number' ||
    typeof item.lineAmountCents !== 'number' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconVendorBillLineItemId,
    organizationId: item.organizationId,
    vendorBillId: item.vendorBillId,
    lineNumber: item.lineNumber,
    lineKind: isLineKind(item.lineKind) ? item.lineKind : 'goods',
    receiptMovementId: s(item.receiptMovementId),
    purchaseOrderLineItemId: s(item.purchaseOrderLineItemId),
    productId: s(item.productId),
    productDescriptionSnapshot: s(item.productDescriptionSnapshot),
    quantityBilled: n(item.quantityBilled),
    grniValueCents: n(item.grniValueCents),
    billedUnitCostCents: n(item.billedUnitCostCents),
    varianceCents: n(item.varianceCents),
    expenseAccountNumber: s(item.expenseAccountNumber),
    expenseDescription: s(item.expenseDescription),
    lineAmountCents: item.lineAmountCents,
    createdAt: item.createdAt,
  };
}

export function buildWixVendorBillLineItemData(line: VendorBillLineItem): WixVendorBillLineItemItem {
  return {
    beaconVendorBillLineItemId: line.id,
    organizationId: line.organizationId,
    vendorBillId: line.vendorBillId,
    lineNumber: line.lineNumber,
    lineKind: line.lineKind,
    receiptMovementId: line.receiptMovementId,
    purchaseOrderLineItemId: line.purchaseOrderLineItemId,
    productId: line.productId,
    productDescriptionSnapshot: line.productDescriptionSnapshot,
    quantityBilled: line.quantityBilled,
    grniValueCents: line.grniValueCents,
    billedUnitCostCents: line.billedUnitCostCents,
    varianceCents: line.varianceCents,
    expenseAccountNumber: line.expenseAccountNumber,
    expenseDescription: line.expenseDescription,
    lineAmountCents: line.lineAmountCents,
    createdAt: line.createdAt,
  };
}
