import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import type { CatalogPriceChange, CatalogPriceItemType } from '../types/catalogPriceChange';
import type { ActivityContext } from './activityService';
import { catalogPriceChangeFixtures } from './__mocks__/pricingFixtures';
import { listItemPriceChanges } from './catalogPriceChangeJournal';

export { isCatalogPriceHistoryLive } from './catalogPriceChangeJournal';

/**
 * Price catalog (2026-11). Price history reads, and the record of a price
 * set by a catalog write that only exists on fictional (mock) data — the
 * administrator catalog's item create/edit (services/priceCatalogService.ts,
 * whose live writes answer 501 until the schema is approved). Those writes
 * are one in-memory step, so their change is recorded already `applied`.
 * Every write that can reach live Wix goes through the pending → applied
 * journal instead (services/catalogPriceChangeJournal.ts).
 */
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
  if (dataAdapterMode !== 'mock') {
    throw new Error('recordCatalogPriceChange is for fictional-data catalog writes only; live price writes use the price change journal.');
  }
  if (change.previousPrice === change.newPrice) return null;
  const changedAt = change.now ?? new Date().toISOString();
  const row: CatalogPriceChange = {
    id: `cpc-${crypto.randomUUID()}`,
    organizationId: ctx.organizationId,
    itemType: change.itemType,
    itemId: change.itemId,
    itemCode: change.itemCode,
    itemName: change.itemName,
    previousPrice: change.previousPrice,
    newPrice: change.newPrice,
    changedBy: ctx.actorIdentityId ?? null,
    changedAt,
    reason: change.reason?.trim() ? change.reason.trim() : null,
    correlationId: ctx.correlationId,
    status: 'applied',
    outcome: 'applied',
    settledAt: changedAt,
    requestKey: null,
  };
  catalogPriceChangeFixtures.push(row);
  return row;
}

/** One item's price history, newest first — organization-scoped. Includes
    each change's status, so a change that was not applied is shown as such. */
export async function listCatalogPriceHistory(
  organizationId: string,
  item: { itemType: CatalogPriceItemType; itemId: string },
  dataAdapterMode: DataAdapterMode,
): Promise<CatalogPriceChange[]> {
  return listItemPriceChanges(organizationId, item, dataAdapterMode);
}
