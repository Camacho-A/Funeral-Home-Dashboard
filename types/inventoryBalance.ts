/**
 * Phase 35 (Merchandise, Inventory & Commerce). A DERIVED, rebuildable
 * per-(product, location) stock snapshot — a read cache over the
 * authoritative `inventoryMovements` ledger and active
 * `inventoryReservations`, never itself the source of truth. It exists so
 * screens, low-stock checks, and reports do not sum the full movement
 * history on every read. See docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 *
 * `onHand` is always Σ(movement.quantity); `reserved` is always
 * Σ(active reservation.quantity). Both are maintained inside the per-stock-
 * line lease that guards every stock mutation, and are fully recomputable
 * from source by the reconcile routine (drift detection). The Wix system
 * `_id` is the natural key `${organizationId}-${locationId}-${productId}`, with
 * a `-${variantId}` segment appended when the balance is for a specific variant
 * (Phase 37) — a null variant keeps the exact original product-level key, so
 * every pre-Phase-37 balance id is unchanged.
 *
 * `available = onHand − reserved` is a pure derivation, not stored — see
 * domain/merchandise/inventoryMath.ts.
 */
export type InventoryBalance = {
  /** Deterministic natural key `${organizationId}-${locationId}-${productId}`
      (+ `-${variantId}` when variant-scoped). */
  id: string;
  organizationId: string;
  productId: string;
  /** Phase 37 (ADR-041): the variant this balance is for, or null for a
      product-level (non-variant) balance. Additive/backward-compatible. */
  variantId: string | null;
  locationId: string;
  onHand: number;
  reserved: number;
  updatedAt: string;
};
