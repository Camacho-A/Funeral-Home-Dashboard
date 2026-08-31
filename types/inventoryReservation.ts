/**
 * Phase 35 (Merchandise, Inventory & Commerce). A case-linked soft hold on
 * merchandise stock, created when a `trackInventory` product is added to a
 * case's CaseOrder. A reservation reduces AVAILABLE (on-hand − reserved) but
 * NOT on-hand — so opening/editing an order never permanently decrements
 * physical stock. See docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 *
 * The row is mutable (its `status` transitions), unlike the immutable
 * `InventoryMovement`. Only fulfillment produces a stock-reducing `sale`
 * movement; until then a reservation is purely a hold.
 *
 * Idempotency: the deterministic id `${organizationId}-${caseId}-${productId}
 * -${locationId}` (with a `-${variantId}` segment appended for a variant,
 * Phase 37) makes re-selecting the same product/variant on the same case an
 * upsert (quantity re-synced to the current order selection), never a second
 * reservation — this is what prevents double-reservation on repricing.
 */
export type ReservationStatus =
  | 'active' // holding stock; counts toward `reserved`
  | 'released' // the line was removed / order cancelled; no longer holds stock
  | 'fulfilled' // the goods were issued (a sale movement was recorded)
  | 'expired'; // reserved for a future TTL-expiry policy; unused this phase

export type InventoryReservation = {
  /** Deterministic — see the header. */
  id: string;
  organizationId: string;
  /** → cases.beaconCaseId. */
  caseId: string;
  /** The CaseOrder version this reservation currently tracks. → caseOrders. */
  caseOrderId: string;
  /** → merchandiseProducts.beaconMerchandiseProductId. */
  productId: string;
  /** Phase 37 (ADR-041): the variant this hold is for, when the product is a
      variant parent; null for a non-variant product (Phase 35) and every
      pre-Phase-37 row. Appended to the deterministic id as `-${variantId}` when
      present — a null variant keeps the original product-level id, so
      re-selecting the same variant on a case is still an idempotent upsert. */
  variantId: string | null;
  /** → organizationLocations.beaconOrganizationLocationId. */
  locationId: string;
  quantity: number;
  status: ReservationStatus;
  /** The deterministic fulfillment key stamped on the `sale` movement +
      COGS entry when this reservation is fulfilled. Null until then. */
  fulfillmentReference: string | null;
  createdAt: string;
  updatedAt: string;
};
