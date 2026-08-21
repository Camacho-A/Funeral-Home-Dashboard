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
 * -${locationId}` makes re-selecting the same product on the same case an
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
