import type { InventoryReservation, ReservationStatus } from '../types/inventoryReservation';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Mapper for the mutable
 * `inventoryReservations` collection (case-linked soft holds).
 */
const VALID_STATUSES: readonly ReservationStatus[] = ['active', 'released', 'fulfilled', 'expired'];
function isStatus(value: unknown): value is ReservationStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

export type WixInventoryReservationItem = {
  beaconInventoryReservationId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  caseOrderId?: unknown;
  productId?: unknown;
  locationId?: unknown;
  quantity?: unknown;
  status?: unknown;
  fulfillmentReference?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixInventoryReservationItem(item: WixInventoryReservationItem | undefined): InventoryReservation | null {
  if (
    !item ||
    typeof item.beaconInventoryReservationId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.caseOrderId !== 'string' ||
    typeof item.productId !== 'string' ||
    typeof item.locationId !== 'string' ||
    typeof item.quantity !== 'number' ||
    !isStatus(item.status) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconInventoryReservationId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    caseOrderId: item.caseOrderId,
    productId: item.productId,
    locationId: item.locationId,
    quantity: item.quantity,
    status: item.status,
    fulfillmentReference: typeof item.fulfillmentReference === 'string' ? item.fulfillmentReference : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixInventoryReservationData(reservation: InventoryReservation): WixInventoryReservationItem {
  return {
    beaconInventoryReservationId: reservation.id,
    organizationId: reservation.organizationId,
    caseId: reservation.caseId,
    caseOrderId: reservation.caseOrderId,
    productId: reservation.productId,
    locationId: reservation.locationId,
    quantity: reservation.quantity,
    status: reservation.status,
    fulfillmentReference: reservation.fulfillmentReference,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

export function applyInventoryReservationUpdateToWixData(
  existing: WixInventoryReservationItem,
  patch: Partial<Pick<InventoryReservation, 'caseOrderId' | 'quantity' | 'status' | 'fulfillmentReference' | 'updatedAt'>>,
): WixInventoryReservationItem {
  const next: WixInventoryReservationItem = { ...existing };
  if (patch.caseOrderId !== undefined) next.caseOrderId = patch.caseOrderId;
  if (patch.quantity !== undefined) next.quantity = patch.quantity;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.fulfillmentReference !== undefined) next.fulfillmentReference = patch.fulfillmentReference;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
