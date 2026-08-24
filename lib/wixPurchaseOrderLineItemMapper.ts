import type { PurchaseOrderLineItem } from '../types/purchaseOrderLineItem';

/**
 * Phase 36 (Procurement & Accounts Payable). Mapper for the
 * `purchaseOrderLineItems` collection. `quantityReceived`/`quantityBilled`
 * are the two mutable rollup fields (reconcilable from movements / bill
 * lines); everything else is a PO-time snapshot. See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
export type WixPurchaseOrderLineItemItem = {
  beaconPurchaseOrderLineItemId?: unknown;
  organizationId?: unknown;
  purchaseOrderId?: unknown;
  lineNumber?: unknown;
  productId?: unknown;
  locationId?: unknown;
  descriptionSnapshot?: unknown;
  quantityOrdered?: unknown;
  unitCostCents?: unknown;
  quantityReceived?: unknown;
  quantityBilled?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixPurchaseOrderLineItemItem(item: WixPurchaseOrderLineItemItem | undefined): PurchaseOrderLineItem | null {
  if (
    !item ||
    typeof item.beaconPurchaseOrderLineItemId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.purchaseOrderId !== 'string' ||
    typeof item.lineNumber !== 'number' ||
    typeof item.productId !== 'string' ||
    typeof item.locationId !== 'string' ||
    typeof item.descriptionSnapshot !== 'string' ||
    typeof item.quantityOrdered !== 'number' ||
    typeof item.unitCostCents !== 'number' ||
    typeof item.quantityReceived !== 'number' ||
    typeof item.quantityBilled !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconPurchaseOrderLineItemId,
    organizationId: item.organizationId,
    purchaseOrderId: item.purchaseOrderId,
    lineNumber: item.lineNumber,
    productId: item.productId,
    locationId: item.locationId,
    descriptionSnapshot: item.descriptionSnapshot,
    quantityOrdered: item.quantityOrdered,
    unitCostCents: item.unitCostCents,
    quantityReceived: item.quantityReceived,
    quantityBilled: item.quantityBilled,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixPurchaseOrderLineItemData(line: PurchaseOrderLineItem): WixPurchaseOrderLineItemItem {
  return {
    beaconPurchaseOrderLineItemId: line.id,
    organizationId: line.organizationId,
    purchaseOrderId: line.purchaseOrderId,
    lineNumber: line.lineNumber,
    productId: line.productId,
    locationId: line.locationId,
    descriptionSnapshot: line.descriptionSnapshot,
    quantityOrdered: line.quantityOrdered,
    unitCostCents: line.unitCostCents,
    quantityReceived: line.quantityReceived,
    quantityBilled: line.quantityBilled,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}

export function applyPurchaseOrderLineItemUpdateToWixData(
  existing: WixPurchaseOrderLineItemItem,
  patch: Partial<Pick<PurchaseOrderLineItem, 'quantityReceived' | 'quantityBilled' | 'updatedAt'>>,
): WixPurchaseOrderLineItemItem {
  const next: WixPurchaseOrderLineItemItem = { ...existing };
  if (patch.quantityReceived !== undefined) next.quantityReceived = patch.quantityReceived;
  if (patch.quantityBilled !== undefined) next.quantityBilled = patch.quantityBilled;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
