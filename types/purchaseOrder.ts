/**
 * Phase 36 (Procurement & Accounts Payable). A purchase order — a
 * COMMITMENT to buy goods from a supplier, NOT a financial transaction. A PO
 * never posts to the general ledger; only physical receiving (Phase 35's
 * inventory subsystem, Dr 1300 / Cr 2100) and vendor billing (Dr 2100 / Cr
 * 2000) touch the GL. See docs/adr/ADR-040-procurement-and-accounts-payable.md.
 *
 * Lifecycle: `draft` → `submitted` (sent to supplier) → `partially_received`
 * / `received` (as goods arrive, derived from line `quantityReceived`) →
 * `closed` (manually finalized) or `cancelled`. Receiving is owned by the
 * inventory subsystem; the PO only tracks fulfillment progress against its
 * lines.
 */
export type PurchaseOrderStatus =
  | 'draft'
  | 'submitted'
  | 'partially_received'
  | 'received'
  | 'closed'
  | 'cancelled';

export type PurchaseOrder = {
  id: string;
  organizationId: string;
  /** Sequential, per-organization human identifier — `PO-000001` — minted
      with the same unique-key + retry mechanism as journal-entry and case
      numbers. */
  poNumber: string;
  supplierId: string;
  /** Receiving destination (→ organizationLocations.beaconLocationId). */
  locationId: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  /** Σ(line quantityOrdered × unitCostCents), cents — a commitment total for
      display; NEVER posted to the GL. */
  subtotalCents: number;
  notes: string | null;
  /** The StaffProfile that created the PO (StaffProfile-space per ADR-034,
      never Identity). Null ⇒ unattributed/system. */
  createdByStaffProfileId: string | null;
  createdAt: string;
  updatedAt: string;
};
