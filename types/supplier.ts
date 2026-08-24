/**
 * Phase 36 (Procurement & Accounts Payable). A structured supplier/vendor —
 * the authoritative relational entity that replaces the free-text
 * `MerchandiseProduct.supplierName` / `InventoryMovement.supplierName` used
 * through Phase 35. Purchase orders, vendor bills, and payments all reference
 * a `Supplier.id`; `supplierName` survives only as historical snapshot /
 * display fallback, never as a relational key after migration. See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 *
 * Suppliers archive via `isActive: false`; they are never hard-deleted, so
 * historical POs/bills referencing a supplier always remain resolvable.
 */
export type Supplier = {
  id: string;
  organizationId: string;
  /** Display name; unique per organization (application-enforced — Wix
      Data's single-field unique index is not organization-scoped). */
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressText: string | null;
  /** Net payment terms in days (e.g. 30 for "Net 30"); seeds a bill's
      default due date. Null ⇒ unspecified. */
  paymentTermsDays: number | null;
  /** Default account NUMBER to debit for this supplier's expense-only
      (non-goods) bills — a convenience default, always overridable per
      bill line. Null ⇒ none. */
  defaultExpenseAccountNumber: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
