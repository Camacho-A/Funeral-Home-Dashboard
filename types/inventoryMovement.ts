/**
 * Phase 35 (Merchandise, Inventory & Commerce). One immutable, append-only
 * stock movement — the AUTHORITATIVE source of truth for inventory. On-hand
 * for a (product, location) is DERIVED by summing every movement's signed
 * `quantity`; it is never read from a single mutable field
 * (`inventoryBalances` is a rebuildable cache of this sum, never the truth).
 * See docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 *
 * A movement is never updated or deleted after creation (mirrors
 * `journalEntryLines`/`signatureRecords`' insert-only discipline). A
 * correction is a NEW compensating movement (`movementType: 'correction'`),
 * never a mutation of history — so inventory, like the ledger, is fully
 * auditable and rebuildable.
 *
 * Reservations are deliberately NOT movements — a soft hold does not change
 * on-hand (see types/inventoryReservation.ts). Only physical stock changes
 * (receiving, the `sale` at fulfillment, returns, damage, shrinkage,
 * transfers, adjustments, corrections) are movements.
 */
export type InventoryMovementType =
  | 'receiving' // stock arrives from a supplier (+)
  | 'sale' // stock leaves at fulfillment of a case merchandise line (−)
  | 'return_restock' // a returned item put back into sellable stock (+)
  | 'return_damage' // a returned item too damaged to restock (no stock change; recorded for audit)
  | 'damage' // an in-stock item damaged and removed (−)
  | 'shrinkage' // stock missing on a count (−)
  | 'transfer_out' // leaves one location (−), paired with a transfer_in
  | 'transfer_in' // arrives at another location (+), paired with a transfer_out
  | 'adjustment' // a deliberate manual on-hand change (± ; reason required)
  | 'correction'; // a compensating fix for a prior mis-entry (± ; reason required)

export type InventoryMovement = {
  id: string;
  organizationId: string;
  /** → merchandiseProducts.beaconMerchandiseProductId. */
  productId: string;
  /** → organizationLocations.beaconOrganizationLocationId. */
  locationId: string;
  /** Signed integer units: receiving/return_restock/transfer_in positive;
      sale/damage/shrinkage/transfer_out negative; adjustment/correction
      either. `return_damage` is 0 (audit-only). */
  quantity: number;
  movementType: InventoryMovementType;
  /** Set for sale/return movements tied to a case; null for
      receiving/transfer/adjustment. → cases.beaconCaseId. */
  caseId: string | null;
  /** The CaseOrder version whose fulfillment produced a sale movement. Null
      otherwise. */
  caseOrderId: string | null;
  /** The reservation a sale/return movement fulfills. Null otherwise. */
  reservationId: string | null;
  /** A deterministic fulfillment key linking a sale movement to its COGS
      journal entry / return reversal. Null otherwise. */
  fulfillmentReference: string | null;
  /** A receiving batch reference (client-supplied or generated) — also the
      idempotency anchor for a receiving movement. Null otherwise. */
  receiptReference: string | null;
  /** Free-text supplier for a receiving movement. Null otherwise. */
  supplierName: string | null;
  /** Integer cents — unit acquisition cost captured at receiving (inventory
      valuation) or the COGS basis snapshot at fulfillment. Null when not
      cost-bearing. */
  unitCost: number | null;
  /** The staff member who performed the movement — StaffProfile.id space
      (ADR-034 layering invariant), never Identity.id. Null for a
      system-generated movement. */
  actorStaffProfileId: string | null;
  /** REQUIRED (application-enforced) for damage/shrinkage/adjustment/
      correction; null otherwise. */
  reason: string | null;
  /** Correlates the movements of one logical operation (e.g. a transfer's
      out+in pair, or a fulfillment's sale movement + COGS posting). */
  correlationId: string;
  createdAt: string;
};
