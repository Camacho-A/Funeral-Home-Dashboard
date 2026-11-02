import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import type { ActivityContext } from './activityService';
import type { CatalogPriceChange, CatalogPriceChangeOutcome, CatalogPriceItemType } from '../types/catalogPriceChange';
import { catalogPriceChangeFixtures, serviceCatalogFixtures } from './__mocks__/pricingFixtures';
import { merchandiseProductFixtures, merchandiseProductVariantFixtures } from './__mocks__/merchandiseFixtures';
import {
  WixDataApiError,
  conditionalPatchWixDataItemFields,
  insertWixDataItem,
  queryAllWixDataItems,
  queryWixDataItems,
} from '../lib/wixDataApi';
import { buildWixCatalogPriceChangeData, mapWixCatalogPriceChangeItem, type WixCatalogPriceChangeItem } from '../lib/wixCatalogPriceChangeMapper';

/**
 * Price history journal (2026-11). Wix Data has no transaction spanning two
 * collections, so a price change and its history row can NOT be written
 * atomically together. What Wix does guarantee (live-verified 2026-10-16,
 * docs/CASE_CONCURRENCY.md) is that one conditional patch of one item
 * applies all of its fields or none. The protocol is built on exactly that:
 *
 *   1. insert the history row as `pending` (if that fails, nothing changes);
 *   2. write the price AND `priceChangeId = <that row's id>` on the item in
 *      one single-item write;
 *   3. settle the row: `applied` or `not_applied`.
 *
 * The item's `priceChangeId` is exact evidence of which recorded change set
 * its current price. If the request dies between 1 and 3, the row stays
 * `pending` and is settled later from that marker — by the next change to
 * the same item, or by an administrator's reconciliation
 * (`reconcileCatalogPriceChanges`). While a change to an item is pending
 * and fresh, a second change to that item is refused (409), so the marker
 * can never move past an unsettled row.
 *
 * A request may carry an idempotency key: the row id is then derived from
 * it, so a repeated request maps to the same row and never changes the
 * price twice.
 */

let historyLive = false;
/** Live storage switch: on only once the `catalogPriceChanges` collection
    exists in Wix (docs/PRICE_CATALOG.md rollout). While off, live price
    writes record their activity event only, as before. */
export function isCatalogPriceHistoryLive(): boolean {
  return historyLive;
}
/** TEST-ONLY: exercise the live (Wix-mode) protocol against the in-memory
    Wix stand-in. Never called by application code. */
export function setCatalogPriceHistoryLiveForTests(value: boolean): void {
  historyLive = value;
}

const COLLECTION = 'catalogPriceChanges';
/** A pending change older than this is treated as interrupted. */
export const PENDING_PRICE_CHANGE_STALE_AFTER_MS = 2 * 60 * 1000;

/** Someone else changed this price after it was read — nothing was
    written. Routes answer 409. */
export class CatalogPriceConflictError extends Error {
  constructor() {
    super('This price was changed by someone else since you opened it. Nothing was saved — reload and try again.');
    this.name = 'CatalogPriceConflictError';
  }
}

export class CatalogPriceChangeInProgressError extends Error {
  constructor() {
    super('Another price change to this item is still being saved. Wait a moment and reload.');
    this.name = 'CatalogPriceChangeInProgressError';
  }
}

/** The outcome of a repeated request (same idempotency key). */
export class DuplicatePriceChangeRequestError extends Error {
  readonly row: CatalogPriceChange;
  constructor(row: CatalogPriceChange) {
    super(
      row.status === 'applied'
        ? 'This price change was already saved.'
        : row.status === 'pending'
          ? 'This price change is still being saved.'
          : 'This price change was not saved. Reload and try again.',
    );
    this.name = 'DuplicatePriceChangeRequestError';
    this.row = row;
  }
}

export function catalogPriceChangeIdFor(organizationId: string, itemType: CatalogPriceItemType, itemId: string, requestKey: string): string {
  return `cpc-${crypto.createHash('sha256').update(`${organizationId}|${itemType}|${itemId}|${requestKey}`).digest('hex').slice(0, 40)}`;
}

type ItemPriceState = { price: number | null; priceChangeId: string | null };

const ITEM_COLLECTIONS: Record<CatalogPriceItemType, { collection: string; idField: string; priceField: string }> = {
  service: { collection: 'serviceCatalog', idField: 'beaconServiceCatalogId', priceField: 'defaultPrice' },
  merchandise_product: { collection: 'merchandiseProducts', idField: 'beaconMerchandiseProductId', priceField: 'retailPrice' },
  merchandise_variant: { collection: 'merchandiseProductVariants', idField: 'beaconMerchandiseProductVariantId', priceField: 'retailPriceOverride' },
};

/** The item's current price and marker, organization-scoped; null when the
    item doesn't exist in this organization. */
export async function readItemPriceState(
  organizationId: string,
  itemType: CatalogPriceItemType,
  itemId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ItemPriceState | null> {
  if (dataAdapterMode === 'mock') {
    const fixtures: Array<{ id: string; organizationId: string; priceChangeId?: string | null } & Record<string, unknown>> =
      itemType === 'service' ? serviceCatalogFixtures : itemType === 'merchandise_product' ? merchandiseProductFixtures : merchandiseProductVariantFixtures;
    const row = fixtures.find((r) => r.id === itemId && r.organizationId === organizationId);
    if (!row) return null;
    return { price: (row[ITEM_COLLECTIONS[itemType].priceField] as number | null) ?? null, priceChangeId: row.priceChangeId ?? null };
  }
  const { collection, idField, priceField } = ITEM_COLLECTIONS[itemType];
  const response = await queryWixDataItems<Record<string, unknown>>(collection, { filter: { organizationId, [idField]: itemId }, paging: { limit: 1 } });
  const data = response.dataItems[0]?.data;
  if (!data || data.organizationId !== organizationId) return null;
  return {
    price: typeof data[priceField] === 'number' ? (data[priceField] as number) : null,
    priceChangeId: typeof data.priceChangeId === 'string' ? data.priceChangeId : null,
  };
}

async function listRows(organizationId: string, filter: Record<string, unknown>, dataAdapterMode: DataAdapterMode): Promise<CatalogPriceChange[]> {
  if (dataAdapterMode === 'mock') {
    return catalogPriceChangeFixtures.filter((r) => r.organizationId === organizationId && Object.entries(filter).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
  }
  const items = await queryAllWixDataItems<WixCatalogPriceChangeItem>(COLLECTION, { organizationId, ...filter });
  return items.map((i) => mapWixCatalogPriceChangeItem(i.data)).filter((r): r is CatalogPriceChange => r !== null && r.organizationId === organizationId);
}

async function getRow(organizationId: string, id: string, dataAdapterMode: DataAdapterMode): Promise<CatalogPriceChange | null> {
  if (dataAdapterMode === 'mock') return catalogPriceChangeFixtures.find((r) => r.id === id && r.organizationId === organizationId) ?? null;
  const response = await queryWixDataItems<WixCatalogPriceChangeItem>(COLLECTION, { filter: { organizationId, beaconCatalogPriceChangeId: id }, paging: { limit: 1 } });
  const row = mapWixCatalogPriceChangeItem(response.dataItems[0]?.data);
  return row && row.organizationId === organizationId ? row : null;
}

/** Settles a pending row, once (conditioned on it still being pending).
    Never throws: a failed settle leaves the row pending, which
    reconciliation resolves from the item's marker. Returns whether this
    call settled it. */
export async function settleCatalogPriceChange(
  row: CatalogPriceChange,
  outcome: CatalogPriceChangeOutcome,
  dataAdapterMode: DataAdapterMode,
  now: string = new Date().toISOString(),
): Promise<boolean> {
  const status = outcome === 'applied' || outcome === 'reconciled_applied' ? 'applied' : 'not_applied';
  try {
    if (dataAdapterMode === 'mock') {
      const index = catalogPriceChangeFixtures.findIndex((r) => r.id === row.id && r.organizationId === row.organizationId);
      if (index === -1 || catalogPriceChangeFixtures[index].status !== 'pending') return false;
      catalogPriceChangeFixtures[index] = { ...catalogPriceChangeFixtures[index], status, outcome, settledAt: now };
      return true;
    }
    const written = await conditionalPatchWixDataItemFields(COLLECTION, row.id, { status, outcome, settledAt: now }, {
      filter: { organizationId: { $eq: row.organizationId }, beaconCatalogPriceChangeId: { $eq: row.id }, status: { $eq: 'pending' } },
    });
    return written.applied;
  } catch (error) {
    console.error('Failed to settle catalog price change (left pending for reconciliation):', error instanceof Error ? error.message : error);
    return false;
  }
}

/** Resolves one pending row from the item's marker. A fresh row (its
    request may still be running) is left alone unless `force`. */
async function resolvePendingRow(row: CatalogPriceChange, dataAdapterMode: DataAdapterMode, options: { nowMs: number; force?: boolean }): Promise<'applied' | 'not_applied' | 'in_progress' | 'item_missing'> {
  if (!options.force && options.nowMs - Date.parse(row.changedAt) < PENDING_PRICE_CHANGE_STALE_AFTER_MS) return 'in_progress';
  const state = await readItemPriceState(row.organizationId, row.itemType, row.itemId, dataAdapterMode);
  if (!state) {
    await settleCatalogPriceChange(row, 'reconciled_not_applied', dataAdapterMode, new Date(options.nowMs).toISOString());
    return 'item_missing';
  }
  const applied = state.priceChangeId === row.id;
  await settleCatalogPriceChange(row, applied ? 'reconciled_applied' : 'reconciled_not_applied', dataAdapterMode, new Date(options.nowMs).toISOString());
  return applied ? 'applied' : 'not_applied';
}

/**
 * Step 1. Records the change as pending, before the price is touched.
 * Throws (and nothing has changed) when the row can't be written, when
 * another change to the same item is still in flight, or when this request
 * was already made (same idempotency key). Returns null when nothing
 * should be recorded: the price isn't changing, or live history storage is
 * switched off (`isCatalogPriceHistoryLive`).
 */
export async function beginCatalogPriceChange(
  ctx: ActivityContext,
  change: {
    itemType: CatalogPriceItemType;
    itemId: string;
    itemCode: string;
    itemName: string;
    previousPrice: number | null;
    newPrice: number | null;
    reason?: string | null;
    requestKey?: string | null;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<CatalogPriceChange | null> {
  if (dataAdapterMode !== 'mock' && !isCatalogPriceHistoryLive()) return null;
  const requestKey = change.requestKey?.trim() ? change.requestKey.trim() : null;
  const id = requestKey ? catalogPriceChangeIdFor(ctx.organizationId, change.itemType, change.itemId, requestKey) : `cpc-${crypto.randomUUID()}`;
  const nowIso = change.now ?? new Date().toISOString();

  if (requestKey) {
    const earlier = await getRow(ctx.organizationId, id, dataAdapterMode);
    if (earlier) throw new DuplicatePriceChangeRequestError(earlier);
  }
  if (change.previousPrice === change.newPrice) return null;

  // An unsettled earlier change to this item: settle it first if it was
  // interrupted, refuse while it may still be running.
  for (const open of await listRows(ctx.organizationId, { itemType: change.itemType, itemId: change.itemId, status: 'pending' }, dataAdapterMode)) {
    const resolved = await resolvePendingRow(open, dataAdapterMode, { nowMs: Date.parse(nowIso) });
    if (resolved === 'in_progress') throw new CatalogPriceChangeInProgressError();
  }

  const row: CatalogPriceChange = {
    id,
    organizationId: ctx.organizationId,
    itemType: change.itemType,
    itemId: change.itemId,
    itemCode: change.itemCode,
    itemName: change.itemName,
    previousPrice: change.previousPrice,
    newPrice: change.newPrice,
    changedBy: ctx.actorIdentityId ?? null,
    changedAt: nowIso,
    reason: change.reason?.trim() ? change.reason.trim() : null,
    correlationId: ctx.correlationId,
    status: 'pending',
    outcome: null,
    settledAt: null,
    requestKey,
  };
  if (dataAdapterMode === 'mock') {
    if (catalogPriceChangeFixtures.some((r) => r.id === row.id)) throw new DuplicatePriceChangeRequestError(catalogPriceChangeFixtures.find((r) => r.id === row.id)!);
    catalogPriceChangeFixtures.push(row);
    return row;
  }
  try {
    await insertWixDataItem<WixCatalogPriceChangeItem>(COLLECTION, buildWixCatalogPriceChangeData(row), row.id);
  } catch (error) {
    // Same idempotency key raced in from a concurrent duplicate request.
    if (error instanceof WixDataApiError && error.status === 409) {
      const landed = await getRow(ctx.organizationId, row.id, dataAdapterMode);
      if (landed) throw new DuplicatePriceChangeRequestError(landed);
    }
    throw error;
  }
  return row;
}

/**
 * Step 3 after a price write whose outcome is unknown (an error, a lost
 * response): reads the item back and settles from its marker. Returns
 * true when the price was in fact applied. If even the read fails, the
 * row is left pending for reconciliation and this returns null.
 */
export async function settleFromItem(row: CatalogPriceChange, dataAdapterMode: DataAdapterMode): Promise<boolean | null> {
  let state: ItemPriceState | null;
  try {
    state = await readItemPriceState(row.organizationId, row.itemType, row.itemId, dataAdapterMode);
  } catch (error) {
    console.error('Price change outcome unknown (left pending for reconciliation):', error instanceof Error ? error.message : error);
    return null;
  }
  const applied = state?.priceChangeId === row.id;
  await settleCatalogPriceChange(row, applied ? 'applied' : 'write_failed', dataAdapterMode);
  return applied;
}

/** Price changes recorded for one item, newest first (status included). */
export async function listItemPriceChanges(
  organizationId: string,
  item: { itemType: CatalogPriceItemType; itemId: string },
  dataAdapterMode: DataAdapterMode,
): Promise<CatalogPriceChange[]> {
  if (dataAdapterMode !== 'mock' && !isCatalogPriceHistoryLive()) return [];
  const rows = await listRows(organizationId, { itemType: item.itemType, itemId: item.itemId }, dataAdapterMode);
  return [...rows].sort((a, b) => (a.changedAt < b.changedAt ? 1 : a.changedAt > b.changedAt ? -1 : 0));
}

export type PriceHistoryReconciliation = {
  /** Pending rows found, and what each was (or would be) settled as. */
  pending: Array<{ id: string; itemType: CatalogPriceItemType; itemId: string; changedAt: string; resolution: 'applied' | 'not_applied' | 'in_progress' | 'item_missing' }>;
  /** Items whose marker names a row that is not `applied` (e.g. a write
      that landed after its request gave up) — corrected to applied. */
  markerMismatches: Array<{ id: string; itemType: CatalogPriceItemType; itemId: string; status: string }>;
  /** Items whose current price differs from the price their marker's row
      set: changed outside SOLIS's price path. Reported, never "fixed". */
  priceDrift: Array<{ itemType: CatalogPriceItemType; itemId: string; recordedPrice: number | null; currentPrice: number | null; priceChangeId: string }>;
  applied: boolean;
};

/**
 * Administrator recovery. Lists every pending price change in the
 * organization and, with `apply`, settles each interrupted one from its
 * item's marker (fresh ones are reported `in_progress` and left alone).
 * Also checks every item a recorded change points at. Never changes a
 * price — only history statuses.
 */
export async function reconcileCatalogPriceChanges(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options: { apply: boolean; nowMs?: number },
): Promise<PriceHistoryReconciliation> {
  const nowMs = options.nowMs ?? Date.now();
  const report: PriceHistoryReconciliation = { pending: [], markerMismatches: [], priceDrift: [], applied: options.apply };
  if (dataAdapterMode !== 'mock' && !isCatalogPriceHistoryLive()) return report;
  const rows = await listRows(organizationId, {}, dataAdapterMode);

  for (const row of rows.filter((r) => r.status === 'pending')) {
    let resolution: PriceHistoryReconciliation['pending'][number]['resolution'];
    if (options.apply) {
      resolution = await resolvePendingRow(row, dataAdapterMode, { nowMs });
    } else if (nowMs - Date.parse(row.changedAt) < PENDING_PRICE_CHANGE_STALE_AFTER_MS) {
      resolution = 'in_progress';
    } else {
      const state = await readItemPriceState(organizationId, row.itemType, row.itemId, dataAdapterMode);
      resolution = !state ? 'item_missing' : state.priceChangeId === row.id ? 'applied' : 'not_applied';
    }
    report.pending.push({ id: row.id, itemType: row.itemType, itemId: row.itemId, changedAt: row.changedAt, resolution });
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = new Map<string, { itemType: CatalogPriceItemType; itemId: string }>();
  for (const r of rows) items.set(`${r.itemType}|${r.itemId}`, { itemType: r.itemType, itemId: r.itemId });
  for (const { itemType, itemId } of items.values()) {
    const state = await readItemPriceState(organizationId, itemType, itemId, dataAdapterMode);
    if (!state?.priceChangeId) continue;
    const marked = byId.get(state.priceChangeId);
    if (!marked) continue;
    const current = options.apply ? (await getRow(organizationId, marked.id, dataAdapterMode)) ?? marked : marked;
    if (current.status === 'not_applied') {
      // The write landed after its request had settled it as not applied:
      // the history is corrected to what actually happened.
      report.markerMismatches.push({ id: current.id, itemType, itemId, status: current.status });
      if (options.apply) await correctToApplied(current, dataAdapterMode, nowMs);
    }
    if (state.price !== current.newPrice) {
      report.priceDrift.push({ itemType, itemId, recordedPrice: current.newPrice, currentPrice: state.price, priceChangeId: current.id });
    }
  }
  return report;
}

/** The one correction a settled row can receive: not_applied → applied,
    when its item's marker proves the write landed. */
async function correctToApplied(row: CatalogPriceChange, dataAdapterMode: DataAdapterMode, nowMs: number): Promise<void> {
  const settledAt = new Date(nowMs).toISOString();
  if (dataAdapterMode === 'mock') {
    const index = catalogPriceChangeFixtures.findIndex((r) => r.id === row.id && r.organizationId === row.organizationId);
    if (index !== -1 && catalogPriceChangeFixtures[index].status === 'not_applied') {
      catalogPriceChangeFixtures[index] = { ...catalogPriceChangeFixtures[index], status: 'applied', outcome: 'reconciled_applied', settledAt };
    }
    return;
  }
  await conditionalPatchWixDataItemFields(COLLECTION, row.id, { status: 'applied', outcome: 'reconciled_applied', settledAt }, {
    filter: { organizationId: { $eq: row.organizationId }, beaconCatalogPriceChangeId: { $eq: row.id }, status: { $eq: 'not_applied' } },
  });
}
