import type { CatalogPriceChange, CatalogPriceChangeOutcome, CatalogPriceChangeStatus, CatalogPriceItemType } from '../types/catalogPriceChange';

/**
 * Price catalog (2026-11). The proposed `catalogPriceChanges` Wix row
 * (docs/PRICE_CATALOG.md). Inserted `pending`; afterwards only
 * status/outcome/settledAt are ever patched, once. Not created in Wix yet.
 */
export type WixCatalogPriceChangeItem = {
  beaconCatalogPriceChangeId?: unknown;
  organizationId?: unknown;
  itemType?: unknown;
  itemId?: unknown;
  itemCode?: unknown;
  itemName?: unknown;
  previousPrice?: unknown;
  newPrice?: unknown;
  changedBy?: unknown;
  changedAt?: unknown;
  reason?: unknown;
  correlationId?: unknown;
  status?: unknown;
  outcome?: unknown;
  settledAt?: unknown;
  requestKey?: unknown;
};

const ITEM_TYPES: readonly CatalogPriceItemType[] = ['service', 'merchandise_product', 'merchandise_variant'];
const STATUSES: readonly CatalogPriceChangeStatus[] = ['pending', 'applied', 'not_applied'];
const OUTCOMES: readonly CatalogPriceChangeOutcome[] = ['applied', 'conflict', 'write_failed', 'reconciled_applied', 'reconciled_not_applied'];
const isPrice = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0);

export function buildWixCatalogPriceChangeData(row: CatalogPriceChange): WixCatalogPriceChangeItem {
  return {
    beaconCatalogPriceChangeId: row.id,
    organizationId: row.organizationId,
    itemType: row.itemType,
    itemId: row.itemId,
    itemCode: row.itemCode,
    itemName: row.itemName,
    previousPrice: row.previousPrice,
    newPrice: row.newPrice,
    changedBy: row.changedBy,
    changedAt: row.changedAt,
    reason: row.reason,
    correlationId: row.correlationId,
    status: row.status,
    outcome: row.outcome,
    settledAt: row.settledAt,
    requestKey: row.requestKey,
  };
}

export function mapWixCatalogPriceChangeItem(item: WixCatalogPriceChangeItem | undefined): CatalogPriceChange | null {
  if (!item) return null;
  if (
    typeof item.beaconCatalogPriceChangeId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    !ITEM_TYPES.includes(item.itemType as CatalogPriceItemType) ||
    typeof item.itemId !== 'string' ||
    typeof item.itemCode !== 'string' ||
    typeof item.itemName !== 'string' ||
    !isPrice(item.previousPrice ?? null) ||
    !isPrice(item.newPrice ?? null) ||
    typeof item.changedAt !== 'string' ||
    typeof item.correlationId !== 'string' ||
    !STATUSES.includes(item.status as CatalogPriceChangeStatus)
  ) {
    return null;
  }
  return {
    id: item.beaconCatalogPriceChangeId,
    organizationId: item.organizationId,
    itemType: item.itemType as CatalogPriceItemType,
    itemId: item.itemId,
    itemCode: item.itemCode,
    itemName: item.itemName,
    previousPrice: (item.previousPrice ?? null) as number | null,
    newPrice: (item.newPrice ?? null) as number | null,
    changedBy: typeof item.changedBy === 'string' ? item.changedBy : null,
    changedAt: item.changedAt,
    reason: typeof item.reason === 'string' ? item.reason : null,
    correlationId: item.correlationId,
    status: item.status as CatalogPriceChangeStatus,
    outcome: OUTCOMES.includes(item.outcome as CatalogPriceChangeOutcome) ? (item.outcome as CatalogPriceChangeOutcome) : null,
    settledAt: typeof item.settledAt === 'string' ? item.settledAt : null,
    requestKey: typeof item.requestKey === 'string' ? item.requestKey : null,
  };
}
