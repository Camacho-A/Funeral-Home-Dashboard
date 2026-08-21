import type { InventoryMovement, InventoryMovementType } from '../types/inventoryMovement';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Mapper for the append-only
 * `inventoryMovements` collection — insert-only (no update/apply helper),
 * mirroring `journalEntryLines`/`signatureRecords`. See
 * docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 */
const VALID_MOVEMENT_TYPES: readonly InventoryMovementType[] = [
  'receiving',
  'sale',
  'return_restock',
  'return_damage',
  'damage',
  'shrinkage',
  'transfer_out',
  'transfer_in',
  'adjustment',
  'correction',
];

function isMovementType(value: unknown): value is InventoryMovementType {
  return typeof value === 'string' && (VALID_MOVEMENT_TYPES as readonly string[]).includes(value);
}

export type WixInventoryMovementItem = {
  beaconInventoryMovementId?: unknown;
  organizationId?: unknown;
  productId?: unknown;
  locationId?: unknown;
  quantity?: unknown;
  movementType?: unknown;
  caseId?: unknown;
  caseOrderId?: unknown;
  reservationId?: unknown;
  fulfillmentReference?: unknown;
  receiptReference?: unknown;
  supplierName?: unknown;
  unitCost?: unknown;
  actorStaffProfileId?: unknown;
  reason?: unknown;
  correlationId?: unknown;
  createdAt?: unknown;
};

const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function mapWixInventoryMovementItem(item: WixInventoryMovementItem | undefined): InventoryMovement | null {
  if (
    !item ||
    typeof item.beaconInventoryMovementId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.productId !== 'string' ||
    typeof item.locationId !== 'string' ||
    typeof item.quantity !== 'number' ||
    !isMovementType(item.movementType) ||
    typeof item.correlationId !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconInventoryMovementId,
    organizationId: item.organizationId,
    productId: item.productId,
    locationId: item.locationId,
    quantity: item.quantity,
    movementType: item.movementType,
    caseId: s(item.caseId),
    caseOrderId: s(item.caseOrderId),
    reservationId: s(item.reservationId),
    fulfillmentReference: s(item.fulfillmentReference),
    receiptReference: s(item.receiptReference),
    supplierName: s(item.supplierName),
    unitCost: n(item.unitCost),
    actorStaffProfileId: s(item.actorStaffProfileId),
    reason: s(item.reason),
    correlationId: item.correlationId,
    createdAt: item.createdAt,
  };
}

export function buildWixInventoryMovementData(movement: InventoryMovement): WixInventoryMovementItem {
  return {
    beaconInventoryMovementId: movement.id,
    organizationId: movement.organizationId,
    productId: movement.productId,
    locationId: movement.locationId,
    quantity: movement.quantity,
    movementType: movement.movementType,
    caseId: movement.caseId,
    caseOrderId: movement.caseOrderId,
    reservationId: movement.reservationId,
    fulfillmentReference: movement.fulfillmentReference,
    receiptReference: movement.receiptReference,
    supplierName: movement.supplierName,
    unitCost: movement.unitCost,
    actorStaffProfileId: movement.actorStaffProfileId,
    reason: movement.reason,
    correlationId: movement.correlationId,
    createdAt: movement.createdAt,
  };
}
