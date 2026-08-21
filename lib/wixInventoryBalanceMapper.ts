import type { InventoryBalance } from '../types/inventoryBalance';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Mapper for the derived
 * `inventoryBalances` snapshot (`_id = ${org}-${loc}-${product}`).
 */
export type WixInventoryBalanceItem = {
  beaconInventoryBalanceId?: unknown;
  organizationId?: unknown;
  productId?: unknown;
  locationId?: unknown;
  onHand?: unknown;
  reserved?: unknown;
  updatedAt?: unknown;
};

export function mapWixInventoryBalanceItem(item: WixInventoryBalanceItem | undefined): InventoryBalance | null {
  if (
    !item ||
    typeof item.beaconInventoryBalanceId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.productId !== 'string' ||
    typeof item.locationId !== 'string' ||
    typeof item.onHand !== 'number' ||
    typeof item.reserved !== 'number' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconInventoryBalanceId,
    organizationId: item.organizationId,
    productId: item.productId,
    locationId: item.locationId,
    onHand: item.onHand,
    reserved: item.reserved,
    updatedAt: item.updatedAt,
  };
}

export function buildWixInventoryBalanceData(balance: InventoryBalance): WixInventoryBalanceItem {
  return {
    beaconInventoryBalanceId: balance.id,
    organizationId: balance.organizationId,
    productId: balance.productId,
    locationId: balance.locationId,
    onHand: balance.onHand,
    reserved: balance.reserved,
    updatedAt: balance.updatedAt,
  };
}

export function applyInventoryBalanceUpdateToWixData(
  existing: WixInventoryBalanceItem,
  patch: Partial<Pick<InventoryBalance, 'onHand' | 'reserved' | 'updatedAt'>>,
): WixInventoryBalanceItem {
  const next: WixInventoryBalanceItem = { ...existing };
  if (patch.onHand !== undefined) next.onHand = patch.onHand;
  if (patch.reserved !== undefined) next.reserved = patch.reserved;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
