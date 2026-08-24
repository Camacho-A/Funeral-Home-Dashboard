import type { PurchaseOrder, PurchaseOrderStatus } from '../types/purchaseOrder';

/**
 * Phase 36 (Procurement & Accounts Payable). Mapper for the `purchaseOrders`
 * collection. `poNumberKey` (`{org}:{poNumber}`) is the Wix unique-index
 * field; `poNumber` is the display value. See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
const VALID_STATUSES: readonly PurchaseOrderStatus[] = ['draft', 'submitted', 'partially_received', 'received', 'closed', 'cancelled'];
function isStatus(v: unknown): v is PurchaseOrderStatus {
  return typeof v === 'string' && (VALID_STATUSES as readonly string[]).includes(v);
}

export type WixPurchaseOrderItem = {
  beaconPurchaseOrderId?: unknown;
  organizationId?: unknown;
  poNumber?: unknown;
  poNumberKey?: unknown;
  supplierId?: unknown;
  locationId?: unknown;
  status?: unknown;
  orderDate?: unknown;
  expectedDate?: unknown;
  subtotalCents?: unknown;
  notes?: unknown;
  createdByStaffProfileId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function mapWixPurchaseOrderItem(item: WixPurchaseOrderItem | undefined): PurchaseOrder | null {
  if (
    !item ||
    typeof item.beaconPurchaseOrderId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.poNumber !== 'string' ||
    typeof item.supplierId !== 'string' ||
    typeof item.locationId !== 'string' ||
    !isStatus(item.status) ||
    typeof item.orderDate !== 'string' ||
    typeof item.subtotalCents !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconPurchaseOrderId,
    organizationId: item.organizationId,
    poNumber: item.poNumber,
    supplierId: item.supplierId,
    locationId: item.locationId,
    status: item.status,
    orderDate: item.orderDate,
    expectedDate: s(item.expectedDate),
    subtotalCents: item.subtotalCents,
    notes: s(item.notes),
    createdByStaffProfileId: s(item.createdByStaffProfileId),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixPurchaseOrderData(po: PurchaseOrder): WixPurchaseOrderItem {
  return {
    beaconPurchaseOrderId: po.id,
    organizationId: po.organizationId,
    poNumber: po.poNumber,
    poNumberKey: `${po.organizationId}:${po.poNumber}`,
    supplierId: po.supplierId,
    locationId: po.locationId,
    status: po.status,
    orderDate: po.orderDate,
    expectedDate: po.expectedDate,
    subtotalCents: po.subtotalCents,
    notes: po.notes,
    createdByStaffProfileId: po.createdByStaffProfileId,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
  };
}

export function applyPurchaseOrderUpdateToWixData(
  existing: WixPurchaseOrderItem,
  patch: Partial<Pick<PurchaseOrder, 'status' | 'expectedDate' | 'subtotalCents' | 'notes' | 'updatedAt'>>,
): WixPurchaseOrderItem {
  const next: WixPurchaseOrderItem = { ...existing };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.expectedDate !== undefined) next.expectedDate = patch.expectedDate;
  if (patch.subtotalCents !== undefined) next.subtotalCents = patch.subtotalCents;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
