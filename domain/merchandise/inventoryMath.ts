import type { InventoryBalance } from '../../types/inventoryBalance';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Pure, I/O-free inventory
 * arithmetic — the single definition of "available" and the low-stock
 * predicate, kept out of both the service layer and UI components so the
 * server and any future consumer agree on one formula. See
 * docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 */

/** Sellable units = on-hand minus active reservations, never below 0. */
export function availableUnits(onHand: number, reserved: number): number {
  return Math.max(0, onHand - reserved);
}

export function availableFromBalance(balance: Pick<InventoryBalance, 'onHand' | 'reserved'>): number {
  return availableUnits(balance.onHand, balance.reserved);
}

/**
 * Low-stock is a threshold CROSSING check, not a level check — it answers
 * "did this movement take on-hand from above the reorder point to at-or-
 * below it," so a single notification fires on the crossing rather than on
 * every decrement while already low (see ADR-039 §23 anti-noise). A null
 * reorderPoint is never low.
 */
export function crossedLowStockThreshold(
  previousOnHand: number,
  nextOnHand: number,
  reorderPoint: number | null,
): boolean {
  if (reorderPoint === null) return false;
  return previousOnHand > reorderPoint && nextOnHand <= reorderPoint;
}

/** Whether on-hand is currently at or below the reorder point (for report
    listings, distinct from the crossing check above). */
export function isLowStock(onHand: number, reorderPoint: number | null): boolean {
  if (reorderPoint === null) return false;
  return onHand <= reorderPoint;
}
