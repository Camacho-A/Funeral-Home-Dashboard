/**
 * Phase 36 (Procurement & Accounts Payable). One ordered product on a
 * purchase order. `quantityReceived` and `quantityBilled` are running
 * rollups maintained for display and status derivation; the AUTHORITATIVE
 * values are always derivable — `quantityReceived` from the sum of the
 * receiving `inventoryMovements` linked to this line, and `quantityBilled`
 * from the sum of non-void `vendorBillLineItems` referencing this line's
 * receipts. The rollups are reconcilable, never the sole source of truth,
 * mirroring how `inventoryBalances` caches over the movement ledger.
 *
 * `descriptionSnapshot` and `unitCostCents` are captured at PO time and are
 * immutable historical snapshots — a later catalog edit never rewrites a
 * PO's recorded intent. See docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
export type PurchaseOrderLineItem = {
  id: string;
  organizationId: string;
  purchaseOrderId: string;
  lineNumber: number;
  productId: string;
  /** Phase 37 (ADR-041): the exact variant being ordered, when the product is
      a variant parent; null for a non-variant product (Phase 35) and every
      pre-Phase-37 PO line. Receiving this line increments only this variant's
      inventory, and AP three-way matching identifies this exact variant.
      → merchandiseProductVariants. */
  variantId: string | null;
  locationId: string;
  /** Product (or variant) name captured at PO time — an immutable snapshot. */
  descriptionSnapshot: string;
  quantityOrdered: number;
  /** Expected acquisition cost per unit at PO time (cents) — an immutable
      snapshot; the actual receipt cost and billed cost may differ. */
  unitCostCents: number;
  /** Running rollup of received quantity (reconcilable from movements). */
  quantityReceived: number;
  /** Running rollup of billed quantity (reconcilable from non-void bill
      lines). */
  quantityBilled: number;
  createdAt: string;
  updatedAt: string;
};
