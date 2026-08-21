import { describe, expect, it } from 'vitest';
import { availableUnits, availableFromBalance, crossedLowStockThreshold, isLowStock } from './inventoryMath';

describe('inventoryMath', () => {
  it('available = onHand − reserved, never below 0', () => {
    expect(availableUnits(10, 3)).toBe(7);
    expect(availableUnits(3, 3)).toBe(0);
    expect(availableUnits(2, 5)).toBe(0); // never negative
  });

  it('availableFromBalance reads onHand/reserved', () => {
    expect(availableFromBalance({ onHand: 8, reserved: 2 })).toBe(6);
  });

  it('low-stock crossing fires only on the downward crossing', () => {
    expect(crossedLowStockThreshold(6, 5, 5)).toBe(true); // 6 → 5, crosses to at-threshold
    expect(crossedLowStockThreshold(5, 4, 5)).toBe(false); // already at/below, no new crossing
    expect(crossedLowStockThreshold(10, 8, 5)).toBe(false); // still above
    expect(crossedLowStockThreshold(4, 6, 5)).toBe(false); // going up, never a low crossing
    expect(crossedLowStockThreshold(6, 5, null)).toBe(false); // no threshold configured
  });

  it('isLowStock is a level check', () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(6, 5)).toBe(false);
    expect(isLowStock(0, 5)).toBe(true);
    expect(isLowStock(0, null)).toBe(false);
  });
});
