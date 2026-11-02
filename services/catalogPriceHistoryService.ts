import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import type { CatalogPriceChange, CatalogPriceItemType } from '../types/catalogPriceChange';
import type { ActivityContext } from './activityService';
import { catalogPriceChangeFixtures } from './__mocks__/pricingFixtures';
import { insertWixDataItem, queryAllWixDataItems } from '../lib/wixDataApi';
import { buildWixCatalogPriceChangeData, mapWixCatalogPriceChangeItem, type WixCatalogPriceChangeItem } from '../lib/wixCatalogPriceChangeMapper';

/**
 * Price catalog (2026-11). The append-only price history. Written BEFORE the
 * price itself changes (the same "audit first" rule the catalog's activity
 * events follow): if the history can't be written, the price isn't changed.
 *
 * Live Wix: the `catalogPriceChanges` collection does not exist yet — it is
 * part of the schema proposal awaiting approval (docs/PRICE_CATALOG.md).
 * Until it is created and this switch is turned on, live price changes are
 * recorded by their activity event only (which also carries the previous
 * and new price); nothing here touches Wix.
 */
export const CATALOG_PRICE_HISTORY_LIVE = false;

export async function recordCatalogPriceChange(
  ctx: ActivityContext,
  change: {
    itemType: CatalogPriceItemType;
    itemId: string;
    itemCode: string;
    itemName: string;
    previousPrice: number | null;
    newPrice: number | null;
    reason?: string | null;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<CatalogPriceChange | null> {
  if (change.previousPrice === change.newPrice) return null;
  const row: CatalogPriceChange = {
    id: crypto.randomUUID(),
    organizationId: ctx.organizationId,
    itemType: change.itemType,
    itemId: change.itemId,
    itemCode: change.itemCode,
    itemName: change.itemName,
    previousPrice: change.previousPrice,
    newPrice: change.newPrice,
    changedBy: ctx.actorIdentityId ?? null,
    changedAt: change.now ?? new Date().toISOString(),
    reason: change.reason?.trim() ? change.reason.trim() : null,
    correlationId: ctx.correlationId,
  };
  if (dataAdapterMode === 'mock') {
    catalogPriceChangeFixtures.push(row);
    return row;
  }
  if (!CATALOG_PRICE_HISTORY_LIVE) return null;
  await insertWixDataItem<WixCatalogPriceChangeItem>('catalogPriceChanges', buildWixCatalogPriceChangeData(row), row.id);
  return row;
}

/** One item's price history, newest first — organization-scoped. */
export async function listCatalogPriceHistory(
  organizationId: string,
  item: { itemType: CatalogPriceItemType; itemId: string },
  dataAdapterMode: DataAdapterMode,
): Promise<CatalogPriceChange[]> {
  let rows: CatalogPriceChange[];
  if (dataAdapterMode === 'mock') {
    rows = catalogPriceChangeFixtures.filter((r) => r.organizationId === organizationId && r.itemType === item.itemType && r.itemId === item.itemId);
  } else {
    if (!CATALOG_PRICE_HISTORY_LIVE) return [];
    const items = await queryAllWixDataItems<WixCatalogPriceChangeItem>('catalogPriceChanges', {
      organizationId,
      itemType: item.itemType,
      itemId: item.itemId,
    });
    rows = items
      .map((i) => mapWixCatalogPriceChangeItem(i.data))
      .filter((r): r is CatalogPriceChange => r !== null && r.organizationId === organizationId);
  }
  return [...rows].sort((a, b) => (a.changedAt < b.changedAt ? 1 : a.changedAt > b.changedAt ? -1 : 0));
}
