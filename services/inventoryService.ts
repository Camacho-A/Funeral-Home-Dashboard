import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixInventoryMovementItem,
  buildWixInventoryMovementData,
  type WixInventoryMovementItem,
} from '../lib/wixInventoryMovementMapper';
import {
  mapWixInventoryReservationItem,
  buildWixInventoryReservationData,
  applyInventoryReservationUpdateToWixData,
  type WixInventoryReservationItem,
} from '../lib/wixInventoryReservationMapper';
import {
  mapWixInventoryBalanceItem,
  buildWixInventoryBalanceData,
  applyInventoryBalanceUpdateToWixData,
  type WixInventoryBalanceItem,
} from '../lib/wixInventoryBalanceMapper';
import type { InventoryMovement, InventoryMovementType } from '../types/inventoryMovement';
import type { InventoryReservation } from '../types/inventoryReservation';
import type { InventoryBalance } from '../types/inventoryBalance';
import { availableUnits, crossedLowStockThreshold } from '../domain/merchandise/inventoryMath';
import { getProductById, getVariantById } from './merchandiseService';
import { resolveVariantEconomics } from '../domain/merchandise/variantEconomics';
import type { MerchandiseProduct } from '../types/merchandiseProduct';
import { withInventoryLock, commitProtectedWrite, stockLineLockKey } from './inventoryLockService';
import { createAndPostJournalEntry, reverseJournalEntry, listJournalEntriesForOrganization } from './generalLedgerService';
import { getAccountByNumber } from './chartOfAccountsService';
import { backfillMissingStarterAccounts } from './chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import {
  recordInventoryReceived,
  recordInventoryReserved,
  recordInventoryReleased,
  recordInventoryFulfilled,
  recordInventoryReturned,
  recordInventoryTransferred,
  recordInventoryAdjusted,
  type ActivityContext,
} from './activityService';
import {
  inventoryMovementFixtures,
  inventoryReservationFixtures,
  inventoryBalanceFixtures,
} from './__mocks__/merchandiseFixtures';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Sole writer of
 * `inventoryMovements` (append-only, authoritative), `inventoryReservations`
 * (mutable), and `inventoryBalances` (derived snapshot). Every stock-mutating
 * operation runs under a per-stock-line lease (services/inventoryLockService.ts)
 * so a read-check-write (reserve/fulfill/adjust) is serialized against the
 * same (org, location, product) — see ADR-039 §29 for the honest residual-
 * race disclosure. On-hand/reserved are always DERIVED from source and the
 * snapshot recomputed from source inside the lease, so it can never drift
 * within a lease and is trivially rebuildable (the reconcile routine reuses
 * the same recompute).
 *
 * Accounting posts through the Phase 31 ledger only
 * (generalLedgerService.createAndPostJournalEntry / reverseJournalEntry),
 * never a parallel calculation. Every posting is idempotent via a
 * deterministic sourceReferenceId checked against existing entries before
 * posting (the ledger has no auto-idempotency).
 */

export class InventoryServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'insufficient_stock' | 'not_found' | 'invalid_input',
  ) {
    super(message);
    this.name = 'InventoryServiceError';
  }
}

// ---------------------------------------------------------------------------
// Low-level reads (source of truth)
// ---------------------------------------------------------------------------

/** Phase 37: `variantId` isolates one variant's stock line. A null variant is
    a product-level (non-variant) stock line — a variant-parent product's
    movements each carry a distinct variantId, so the read MUST filter by it.
    Variant filtering is done in JS (mapper defaults an absent field to null) so
    the exact-null match is reliable regardless of Wix's absent-field query
    semantics; the Wix query itself keeps the original (org, product, location)
    filter for backward compatibility. */
async function listMovementsForStockLine(organizationId: string, productId: string, locationId: string, dataAdapterMode: DataAdapterMode, variantId: string | null = null): Promise<InventoryMovement[]> {
  if (dataAdapterMode === 'mock') {
    return inventoryMovementFixtures.filter((m) => m.organizationId === organizationId && m.productId === productId && m.locationId === locationId && (m.variantId ?? null) === variantId);
  }
  const response = await queryWixDataItems<WixInventoryMovementItem>('inventoryMovements', { filter: { organizationId, productId, locationId } });
  return response.dataItems.map((i) => mapWixInventoryMovementItem(i.data)).filter((m): m is InventoryMovement => m !== null && (m.variantId ?? null) === variantId);
}

async function findMovementById(id: string, dataAdapterMode: DataAdapterMode): Promise<InventoryMovement | null> {
  if (dataAdapterMode === 'mock') return inventoryMovementFixtures.find((m) => m.id === id) ?? null;
  const response = await queryWixDataItems<WixInventoryMovementItem>('inventoryMovements', { filter: { beaconInventoryMovementId: id }, paging: { limit: 1 } });
  return mapWixInventoryMovementItem(response.dataItems[0]?.data);
}

async function listActiveReservationsForStockLine(organizationId: string, productId: string, locationId: string, dataAdapterMode: DataAdapterMode, variantId: string | null = null): Promise<InventoryReservation[]> {
  if (dataAdapterMode === 'mock') {
    return inventoryReservationFixtures.filter((r) => r.organizationId === organizationId && r.productId === productId && r.locationId === locationId && r.status === 'active' && (r.variantId ?? null) === variantId);
  }
  const response = await queryWixDataItems<WixInventoryReservationItem>('inventoryReservations', { filter: { organizationId, productId, locationId, status: 'active' } });
  return response.dataItems.map((i) => mapWixInventoryReservationItem(i.data)).filter((r): r is InventoryReservation => r !== null && (r.variantId ?? null) === variantId);
}

async function findReservationById(id: string, dataAdapterMode: DataAdapterMode): Promise<InventoryReservation | null> {
  if (dataAdapterMode === 'mock') return inventoryReservationFixtures.find((r) => r.id === id) ?? null;
  const response = await queryWixDataItems<WixInventoryReservationItem>('inventoryReservations', { filter: { beaconInventoryReservationId: id }, paging: { limit: 1 } });
  return mapWixInventoryReservationItem(response.dataItems[0]?.data);
}

/** Phase 37: the stock-line/balance natural key (`inventoryBalances._id`).
    Backward-compatible — a null variant yields the exact original
    `${org}-${loc}-${product}` id, so every pre-Phase-37 balance id is unchanged.
    With a variant the naive `-${variantId}` suffix would exceed Wix's 128-char
    `_id` cap (org + three UUIDs = 129), so the variant case hashes the full
    natural key to a fixed 44-char id (variant balances are all new in P37). */
function stockBalanceId(organizationId: string, locationId: string, productId: string, variantId: string | null): string {
  if (!variantId) return `${organizationId}-${locationId}-${productId}`;
  const digest = crypto.createHash('sha256').update(`bal|${organizationId}|${locationId}|${productId}|${variantId}`).digest('hex').slice(0, 40);
  return `bal-${digest}`;
}

/** Phase 37: the reservation natural key. A null variant keeps the exact
    Phase 35 id; with a variant the composed key (org + caseId + two UUIDs +
    variant UUID) would exceed the 128-char cap, so it hashes to a fixed 44-char
    id. Derived ids (`sale-`/`return-`/`fulfill-`/`merch-cogs-`) stay bounded. */
function reservationId(organizationId: string, caseId: string, productId: string, locationId: string, variantId: string | null = null): string {
  if (!variantId) return `${organizationId}-${caseId}-${productId}-${locationId}`;
  const digest = crypto.createHash('sha256').update(`res|${organizationId}|${caseId}|${productId}|${locationId}|${variantId}`).digest('hex').slice(0, 40);
  return `res-${digest}`;
}

/**
 * Deterministic, idempotent, length-bounded `_id` for a receiving movement.
 *
 * The natural key of a receipt is (organizationId, receiptReference, productId,
 * locationId): re-receiving the same reference for the same stock line must
 * resolve to the SAME movement row (idempotency anchor). The obvious
 * concatenation of those components blows past Wix Data's hard 128-char `_id`
 * cap (WDE0075) once the reference itself carries a UUID — as it does on the
 * PO-driven path, where `receiveAgainstPurchaseOrder` appends the PO line's
 * UUID so two lines of one physical receipt get distinct movements. Hashing the
 * full natural key to a fixed 48-char id keeps determinism + idempotency +
 * per-line disambiguation while always fitting the cap, on both the PO and the
 * ad-hoc receiving paths uniformly.
 */
function receivingMovementId(organizationId: string, receiptReference: string, productId: string, locationId: string, variantId: string | null = null): string {
  // Phase 37: a variant is appended to the hashed natural key so two variants
  // of one receipt get distinct movements. Backward-compatible — a null variant
  // reproduces the exact Phase 36 pre-image, so existing receipts stay
  // idempotent; still a fixed 48 chars, safely under Wix's 128-char _id cap.
  const preimage = variantId
    ? `${organizationId}|${receiptReference}|${productId}|${locationId}|${variantId}`
    : `${organizationId}|${receiptReference}|${productId}|${locationId}`;
  const digest = crypto.createHash('sha256').update(preimage).digest('hex').slice(0, 40);
  return `receive-${digest}`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function insertMovement(movement: InventoryMovement, dataAdapterMode: DataAdapterMode): Promise<InventoryMovement> {
  if (dataAdapterMode === 'mock') {
    inventoryMovementFixtures.push(movement);
    return movement;
  }
  const inserted = await insertWixDataItem<WixInventoryMovementItem>('inventoryMovements', buildWixInventoryMovementData(movement), movement.id);
  return mapWixInventoryMovementItem(inserted.data)!;
}

async function upsertReservation(reservation: InventoryReservation, dataAdapterMode: DataAdapterMode): Promise<InventoryReservation> {
  if (dataAdapterMode === 'mock') {
    const idx = inventoryReservationFixtures.findIndex((r) => r.id === reservation.id);
    if (idx === -1) inventoryReservationFixtures.push(reservation);
    else inventoryReservationFixtures[idx] = reservation;
    return reservation;
  }
  const response = await queryWixDataItems<WixInventoryReservationItem>('inventoryReservations', { filter: { beaconInventoryReservationId: reservation.id }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) {
    const inserted = await insertWixDataItem<WixInventoryReservationItem>('inventoryReservations', buildWixInventoryReservationData(reservation), reservation.id);
    return mapWixInventoryReservationItem(inserted.data)!;
  }
  const merged = applyInventoryReservationUpdateToWixData(existingItem.data, {
    caseOrderId: reservation.caseOrderId,
    quantity: reservation.quantity,
    status: reservation.status,
    fulfillmentReference: reservation.fulfillmentReference,
    updatedAt: reservation.updatedAt,
  });
  const updated = await updateWixDataItem<WixInventoryReservationItem>('inventoryReservations', existingItem.id, merged);
  return mapWixInventoryReservationItem(updated.data)!;
}

/**
 * Recompute the (product, location) snapshot from the authoritative
 * movements + active reservations and persist it. Called inside the lease
 * after every mutation, so the snapshot never drifts within a lease and is
 * always exactly rebuildable — the reconcile routine is literally this same
 * call. Returns the fresh balance.
 */
async function recomputeBalance(organizationId: string, productId: string, locationId: string, now: string, dataAdapterMode: DataAdapterMode, variantId: string | null = null): Promise<InventoryBalance> {
  const movements = await listMovementsForStockLine(organizationId, productId, locationId, dataAdapterMode, variantId);
  const reservations = await listActiveReservationsForStockLine(organizationId, productId, locationId, dataAdapterMode, variantId);
  const onHand = movements.reduce((sum, m) => sum + m.quantity, 0);
  const reserved = reservations.reduce((sum, r) => sum + r.quantity, 0);
  const id = stockBalanceId(organizationId, locationId, productId, variantId);
  const balance: InventoryBalance = { id, organizationId, productId, variantId, locationId, onHand, reserved, updatedAt: now };

  if (dataAdapterMode === 'mock') {
    const idx = inventoryBalanceFixtures.findIndex((b) => b.id === id);
    if (idx === -1) inventoryBalanceFixtures.push(balance);
    else inventoryBalanceFixtures[idx] = balance;
    return balance;
  }
  const response = await queryWixDataItems<WixInventoryBalanceItem>('inventoryBalances', { filter: { beaconInventoryBalanceId: id }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) {
    const inserted = await insertWixDataItem<WixInventoryBalanceItem>('inventoryBalances', buildWixInventoryBalanceData(balance), id);
    return mapWixInventoryBalanceItem(inserted.data)!;
  }
  const merged = applyInventoryBalanceUpdateToWixData(existingItem.data, { onHand, reserved, updatedAt: now });
  const updated = await updateWixDataItem<WixInventoryBalanceItem>('inventoryBalances', existingItem.id, merged);
  return mapWixInventoryBalanceItem(updated.data)!;
}

// ---------------------------------------------------------------------------
// Accounting (idempotent postings through the Phase 31 ledger only)
// ---------------------------------------------------------------------------

async function resolveAccount(organizationId: string, accountNumber: string, idFactory: () => string, dataAdapterMode: DataAdapterMode) {
  let account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  if (!account) {
    // Add-only backfill (also seeds a brand-new org's chart) — never throws
    // if the org simply hadn't been seeded/backfilled yet.
    await backfillMissingStarterAccounts(organizationId, idFactory, dataAdapterMode);
    account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  }
  if (!account) throw new InventoryServiceError(`Ledger account ${accountNumber} could not be resolved for organization ${organizationId}.`, 'invalid_input');
  return account;
}

/** Phase 37: the effective COGS/valuation cost basis for a sellable unit —
    a variant's `costOverride` resolves to the parent product's `cost` (B2),
    matching the retail-price resolution in pricing. Returns null cost only when
    the product itself is missing (mirrors the pre-Phase-37 `product?.cost`
    behavior). */
async function resolveSellableCost(organizationId: string, productId: string, variantId: string | null, dataAdapterMode: DataAdapterMode): Promise<{ product: MerchandiseProduct | null; cost: number | null }> {
  const product = await getProductById(organizationId, productId, dataAdapterMode);
  if (!product) return { product: null, cost: null };
  const variant = variantId ? await getVariantById(organizationId, variantId, dataAdapterMode) : null;
  return { product, cost: resolveVariantEconomics(product, variant).cost };
}

async function alreadyPosted(organizationId: string, sourceType: string, sourceReferenceId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const entries = await listJournalEntriesForOrganization(organizationId, dataAdapterMode);
  return entries.some((e) => e.sourceType === sourceType && e.sourceReferenceId === sourceReferenceId);
}

async function findEntryBySourceReference(organizationId: string, sourceType: string, sourceReferenceId: string, dataAdapterMode: DataAdapterMode) {
  const entries = await listJournalEntriesForOrganization(organizationId, dataAdapterMode);
  return entries.find((e) => e.sourceType === sourceType && e.sourceReferenceId === sourceReferenceId) ?? null;
}

/** Dr Inventory Asset (1300) / Cr Inventory Clearing (2100) at receiving. */
async function postInventoryReceipt(organizationId: string, sourceReferenceId: string, amountCents: number, actorStaffProfileId: string | null, idFactory: () => string, now: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (amountCents <= 0) return;
  if (await alreadyPosted(organizationId, 'inventory_receipt', sourceReferenceId, dataAdapterMode)) return;
  const inventory = await resolveAccount(organizationId, STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET, idFactory, dataAdapterMode);
  const clearing = await resolveAccount(organizationId, STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING, idFactory, dataAdapterMode);
  await createAndPostJournalEntry(
    organizationId,
    { entryDate: now, sourceType: 'inventory_receipt', sourceReferenceId, memo: `Inventory received (${sourceReferenceId})`, lines: [{ accountId: inventory.id, direction: 'debit', amount: amountCents }, { accountId: clearing.id, direction: 'credit', amount: amountCents }], postedByStaffProfileId: actorStaffProfileId, idFactory, now },
    dataAdapterMode,
  );
}

/** Dr COGS (5100) / Cr Inventory Asset (1300) at fulfillment. */
async function postCogs(organizationId: string, caseId: string, sourceReferenceId: string, amountCents: number, actorStaffProfileId: string | null, idFactory: () => string, now: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (amountCents <= 0) return;
  if (await alreadyPosted(organizationId, 'cogs', sourceReferenceId, dataAdapterMode)) return;
  const cogs = await resolveAccount(organizationId, STARTER_ACCOUNT_NUMBERS.COST_OF_GOODS_SOLD, idFactory, dataAdapterMode);
  const inventory = await resolveAccount(organizationId, STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET, idFactory, dataAdapterMode);
  await createAndPostJournalEntry(
    organizationId,
    { entryDate: now, sourceType: 'cogs', sourceReferenceId, caseId, memo: `Cost of goods sold (${sourceReferenceId})`, lines: [{ accountId: cogs.id, direction: 'debit', amount: amountCents, caseId }, { accountId: inventory.id, direction: 'credit', amount: amountCents, caseId }], postedByStaffProfileId: actorStaffProfileId, idFactory, now },
    dataAdapterMode,
  );
}

/** Dr/Cr Inventory Shrinkage Expense (5110) vs Inventory Asset (1300) for an
    inventory loss (negative) or found-stock correction (positive). */
async function postInventoryAdjustment(organizationId: string, sourceReferenceId: string, valueDeltaCents: number, actorStaffProfileId: string | null, idFactory: () => string, now: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (valueDeltaCents === 0) return;
  if (await alreadyPosted(organizationId, 'inventory_adjustment', sourceReferenceId, dataAdapterMode)) return;
  const shrinkage = await resolveAccount(organizationId, STARTER_ACCOUNT_NUMBERS.INVENTORY_SHRINKAGE_EXPENSE, idFactory, dataAdapterMode);
  const inventory = await resolveAccount(organizationId, STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET, idFactory, dataAdapterMode);
  const amount = Math.abs(valueDeltaCents);
  // A loss (valueDeltaCents < 0): Dr Shrinkage / Cr Inventory. A found-stock
  // correction (> 0): Dr Inventory / Cr Shrinkage (reduces the expense).
  const lines = valueDeltaCents < 0
    ? [{ accountId: shrinkage.id, direction: 'debit' as const, amount }, { accountId: inventory.id, direction: 'credit' as const, amount }]
    : [{ accountId: inventory.id, direction: 'debit' as const, amount }, { accountId: shrinkage.id, direction: 'credit' as const, amount }];
  await createAndPostJournalEntry(
    organizationId,
    { entryDate: now, sourceType: 'inventory_adjustment', sourceReferenceId, memo: `Inventory adjustment (${sourceReferenceId})`, lines, postedByStaffProfileId: actorStaffProfileId, idFactory, now },
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

export type StockLevel = { productId: string; variantId: string | null; locationId: string; onHand: number; reserved: number; available: number };

export async function getStockLevel(organizationId: string, productId: string, locationId: string, dataAdapterMode: DataAdapterMode, variantId: string | null = null): Promise<StockLevel> {
  const movements = await listMovementsForStockLine(organizationId, productId, locationId, dataAdapterMode, variantId);
  const reservations = await listActiveReservationsForStockLine(organizationId, productId, locationId, dataAdapterMode, variantId);
  const onHand = movements.reduce((sum, m) => sum + m.quantity, 0);
  const reserved = reservations.reduce((sum, r) => sum + r.quantity, 0);
  return { productId, variantId, locationId, onHand, reserved, available: availableUnits(onHand, reserved) };
}

/** Phase 37 bifurcation guard support: does this product have any PRODUCT-LEVEL
    (variantId = null) stock in use — non-zero on-hand at any location, or an
    active reservation? Used to fail-closed before converting a non-variant
    product into a variant parent (never silently redistribute product-level
    stock among variants — decision R6). */
export async function productLevelStockInUse(organizationId: string, productId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const movements = (await (async () => {
    if (dataAdapterMode === 'mock') return inventoryMovementFixtures.filter((m) => m.organizationId === organizationId && m.productId === productId);
    const response = await queryWixDataItems<WixInventoryMovementItem>('inventoryMovements', { filter: { organizationId, productId } });
    return response.dataItems.map((i) => mapWixInventoryMovementItem(i.data)).filter((m): m is InventoryMovement => m !== null);
  })()).filter((m) => (m.variantId ?? null) === null);
  const byLocation = new Map<string, number>();
  for (const m of movements) byLocation.set(m.locationId, (byLocation.get(m.locationId) ?? 0) + m.quantity);
  if ([...byLocation.values()].some((onHand) => onHand !== 0)) return true;

  const reservations = (await (async () => {
    if (dataAdapterMode === 'mock') return inventoryReservationFixtures.filter((r) => r.organizationId === organizationId && r.productId === productId && r.status === 'active');
    const response = await queryWixDataItems<WixInventoryReservationItem>('inventoryReservations', { filter: { organizationId, productId, status: 'active' } });
    return response.dataItems.map((i) => mapWixInventoryReservationItem(i.data)).filter((r): r is InventoryReservation => r !== null);
  })()).filter((r) => (r.variantId ?? null) === null && r.quantity > 0);
  return reservations.length > 0;
}

/** Phase 37: does a specific VARIANT have any stock in use (non-zero on-hand at
    any location, or an active reservation)? Fail-closed guard before archiving a
    variant. */
export async function variantStockInUse(organizationId: string, productId: string, variantId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  // Aggregate across every location for this variant.
  const all = (dataAdapterMode === 'mock'
    ? inventoryMovementFixtures.filter((m) => m.organizationId === organizationId && m.productId === productId)
    : (await queryWixDataItems<WixInventoryMovementItem>('inventoryMovements', { filter: { organizationId, productId } })).dataItems.map((i) => mapWixInventoryMovementItem(i.data)).filter((m): m is InventoryMovement => m !== null)
  ).filter((m) => (m.variantId ?? null) === variantId);
  const byLocation = new Map<string, number>();
  for (const m of all) byLocation.set(m.locationId, (byLocation.get(m.locationId) ?? 0) + m.quantity);
  if ([...byLocation.values()].some((onHand) => onHand !== 0)) return true;
  const reservations = (dataAdapterMode === 'mock'
    ? inventoryReservationFixtures.filter((r) => r.organizationId === organizationId && r.productId === productId && r.status === 'active')
    : (await queryWixDataItems<WixInventoryReservationItem>('inventoryReservations', { filter: { organizationId, productId, status: 'active' } })).dataItems.map((i) => mapWixInventoryReservationItem(i.data)).filter((r): r is InventoryReservation => r !== null)
  ).filter((r) => (r.variantId ?? null) === variantId && r.quantity > 0);
  return reservations.length > 0;
}

export async function listBalancesForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<InventoryBalance[]> {
  if (dataAdapterMode === 'mock') return inventoryBalanceFixtures.filter((b) => b.organizationId === organizationId);
  const response = await queryWixDataItems<WixInventoryBalanceItem>('inventoryBalances', { filter: { organizationId } });
  return response.dataItems.map((i) => mapWixInventoryBalanceItem(i.data)).filter((b): b is InventoryBalance => b !== null);
}

export async function listMovementsForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<InventoryMovement[]> {
  if (dataAdapterMode === 'mock') return inventoryMovementFixtures.filter((m) => m.organizationId === organizationId && m.caseId === caseId);
  const response = await queryWixDataItems<WixInventoryMovementItem>('inventoryMovements', { filter: { organizationId, caseId } });
  return response.dataItems.map((i) => mapWixInventoryMovementItem(i.data)).filter((m): m is InventoryMovement => m !== null);
}

export async function listMovementsByType(organizationId: string, movementType: InventoryMovementType, dataAdapterMode: DataAdapterMode): Promise<InventoryMovement[]> {
  if (dataAdapterMode === 'mock') return inventoryMovementFixtures.filter((m) => m.organizationId === organizationId && m.movementType === movementType);
  const response = await queryWixDataItems<WixInventoryMovementItem>('inventoryMovements', { filter: { organizationId, movementType } });
  return response.dataItems.map((i) => mapWixInventoryMovementItem(i.data)).filter((m): m is InventoryMovement => m !== null);
}

/** Phase 36: a scoped read of one movement by id — accountsPayableService
    uses it to read a receipt's cost basis when a vendor bill clears its GRNI.
    Reads only; inventoryService remains the sole WRITER of movements. */
export async function getMovementById(organizationId: string, movementId: string, dataAdapterMode: DataAdapterMode): Promise<InventoryMovement | null> {
  const movement = await findMovementById(movementId, dataAdapterMode);
  return movement && movement.organizationId === organizationId ? movement : null;
}

export async function listReservationsForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<InventoryReservation[]> {
  if (dataAdapterMode === 'mock') return inventoryReservationFixtures.filter((r) => r.organizationId === organizationId && r.caseId === caseId);
  const response = await queryWixDataItems<WixInventoryReservationItem>('inventoryReservations', { filter: { organizationId, caseId } });
  return response.dataItems.map((i) => mapWixInventoryReservationItem(i.data)).filter((r): r is InventoryReservation => r !== null);
}

// ---------------------------------------------------------------------------
// Writes (all under the per-stock-line lease)
// ---------------------------------------------------------------------------

export type ReceiveStockInput = {
  organizationId: string;
  productId: string;
  /** Phase 37: the variant being received, for a variant-parent product; null
      for a non-variant product. Isolates this variant's stock line. */
  variantId?: string | null;
  locationId: string;
  quantity: number;
  unitCost: number; // cents
  supplierName?: string | null;
  /** Phase 36: the PO line this receipt fulfills — links the receiving
      movement to its purchase order for three-way matching. Null for ad-hoc
      (non-PO) receiving. Receiving remains owned by this inventory service;
      the PO link is pure traceability metadata. */
  purchaseOrderLineItemId?: string | null;
  receiptReference: string; // idempotency anchor
  actorStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function receiveStock(input: ReceiveStockInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ movement: InventoryMovement | null; balance: InventoryBalance }> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new InventoryServiceError('Receiving quantity must be a positive integer.', 'invalid_input');
  if (!Number.isInteger(input.unitCost) || input.unitCost < 0) throw new InventoryServiceError('unitCost must be a non-negative integer number of cents.', 'invalid_input');
  const now = input.now ?? new Date().toISOString();
  const variantId = input.variantId ?? null;
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId, variantId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    const movementId = receivingMovementId(input.organizationId, input.receiptReference, input.productId, input.locationId, variantId);
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      let movement: InventoryMovement | null = await findMovementById(movementId, dataAdapterMode);
      if (!movement) {
        movement = await insertMovement({
          id: movementId,
          organizationId: input.organizationId,
          productId: input.productId,
          variantId,
          locationId: input.locationId,
          quantity: input.quantity,
          movementType: 'receiving',
          caseId: null,
          caseOrderId: null,
          reservationId: null,
          fulfillmentReference: null,
          receiptReference: input.receiptReference,
          supplierName: input.supplierName ?? null,
          purchaseOrderLineItemId: input.purchaseOrderLineItemId ?? null,
          unitCost: input.unitCost,
          actorStaffProfileId: input.actorStaffProfileId ?? null,
          reason: null,
          correlationId: ctx.correlationId,
          createdAt: now,
        }, dataAdapterMode);
        await postInventoryReceipt(input.organizationId, `merch-recv-${movementId}`, input.unitCost * input.quantity, input.actorStaffProfileId ?? null, input.idFactory, now, dataAdapterMode);
        await bestEffort(() => recordInventoryReceived(ctx, input.productId, input.locationId, input.quantity, dataAdapterMode));
      }
      const balance = await recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode, variantId);
      return { movement, balance };
    });
  });
}

export type SyncReservationInput = {
  organizationId: string;
  caseId: string;
  caseOrderId: string;
  productId: string;
  /** Phase 37: the variant being reserved, for a variant-parent product; null
      for a non-variant product. */
  variantId?: string | null;
  locationId: string;
  quantity: number; // desired reserved quantity (0 releases)
  idFactory: () => string;
  now?: string;
};

/**
 * Idempotent upsert of a case's reservation for one (product, location). The
 * deterministic id makes re-selecting the same product on the same case a
 * quantity re-sync, never a second reservation. Throws `insufficient_stock`
 * if the desired quantity exceeds what is available (available already
 * excludes this reservation's own current hold, so raising a hold you
 * already have never falsely fails).
 */
export async function syncReservation(input: SyncReservationInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ reservation: InventoryReservation; balance: InventoryBalance }> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new InventoryServiceError('Reservation quantity must be a non-negative integer.', 'invalid_input');
  const now = input.now ?? new Date().toISOString();
  const variantId = input.variantId ?? null;
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId, variantId);
  const id = reservationId(input.organizationId, input.caseId, input.productId, input.locationId, variantId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      const level = await getStockLevel(input.organizationId, input.productId, input.locationId, dataAdapterMode, variantId);
      const existing = await findReservationById(id, dataAdapterMode);
      const currentHold = existing && existing.status === 'active' ? existing.quantity : 0;
      // Availability excluding THIS reservation's own current hold.
      const availableExcludingThis = availableUnits(level.onHand, level.reserved - currentHold);
      if (input.quantity > availableExcludingThis) {
        throw new InventoryServiceError(`Only ${availableExcludingThis} unit(s) available; cannot reserve ${input.quantity}.`, 'insufficient_stock');
      }

      const status = input.quantity === 0 ? 'released' : 'active';
      const reservation: InventoryReservation = existing
        ? { ...existing, caseOrderId: input.caseOrderId, quantity: input.quantity, status, updatedAt: now }
        : { id, organizationId: input.organizationId, caseId: input.caseId, caseOrderId: input.caseOrderId, productId: input.productId, variantId, locationId: input.locationId, quantity: input.quantity, status, fulfillmentReference: null, createdAt: now, updatedAt: now };
      await upsertReservation(reservation, dataAdapterMode);
      const balance = await recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode, variantId);

      const delta = input.quantity - currentHold;
      if (delta > 0) await bestEffort(() => recordInventoryReserved(ctx, input.caseId, input.productId, input.locationId, delta, dataAdapterMode));
      else if (delta < 0) await bestEffort(() => recordInventoryReleased(ctx, input.caseId, input.productId, input.locationId, -delta, dataAdapterMode));
      return { reservation, balance };
    });
  });
}

export async function releaseReservation(organizationId: string, caseId: string, productId: string, locationId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string, variantId: string | null = null): Promise<InventoryBalance> {
  const result = await syncReservation({ organizationId, caseId, caseOrderId: '', productId, variantId, locationId, quantity: 0, idFactory: () => crypto.randomUUID(), now }, ctx, dataAdapterMode);
  return result.balance;
}

export type FulfillReservationInput = {
  organizationId: string;
  caseId: string;
  productId: string;
  variantId?: string | null;
  locationId: string;
  actorStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

/**
 * Issues the goods for a case's active reservation: a `sale` movement
 * reduces on-hand, the reservation goes `fulfilled`, and COGS posts
 * (Dr 5100 / Cr 1300) at the product's current cost. Returns whether the
 * fulfillment crossed the low-stock threshold (the caller fires the single
 * low-stock notification — anti-noise by construction).
 */
export async function fulfillReservation(input: FulfillReservationInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ balance: InventoryBalance; lowStockCrossed: boolean }> {
  const now = input.now ?? new Date().toISOString();
  const variantId = input.variantId ?? null;
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId, variantId);
  const id = reservationId(input.organizationId, input.caseId, input.productId, input.locationId, variantId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      const reservation = await findReservationById(id, dataAdapterMode);
      if (!reservation || reservation.status !== 'active') throw new InventoryServiceError('No active reservation to fulfill.', 'not_found');
      const { product, cost } = await resolveSellableCost(input.organizationId, input.productId, variantId, dataAdapterMode);

      const before = await getStockLevel(input.organizationId, input.productId, input.locationId, dataAdapterMode, variantId);
      const fulfillmentReference = `fulfill-${id}`;
      const saleMovementId = `sale-${id}`;
      const existingSale = await findMovementById(saleMovementId, dataAdapterMode);
      if (!existingSale) {
        await insertMovement({
          id: saleMovementId, organizationId: input.organizationId, productId: input.productId, variantId, locationId: input.locationId, quantity: -reservation.quantity, movementType: 'sale',
          caseId: input.caseId, caseOrderId: reservation.caseOrderId, reservationId: id, fulfillmentReference, receiptReference: null, supplierName: null, purchaseOrderLineItemId: null,
          unitCost: cost, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: null, correlationId: ctx.correlationId, createdAt: now,
        }, dataAdapterMode);
      }
      await upsertReservation({ ...reservation, status: 'fulfilled', fulfillmentReference, updatedAt: now }, dataAdapterMode);
      await postCogs(input.organizationId, input.caseId, `merch-cogs-${id}`, (cost ?? 0) * reservation.quantity, input.actorStaffProfileId ?? null, input.idFactory, now, dataAdapterMode);
      await bestEffort(() => recordInventoryFulfilled(ctx, input.caseId, input.productId, input.locationId, reservation.quantity, dataAdapterMode));

      const balance = await recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode, variantId);
      const lowStockCrossed = crossedLowStockThreshold(before.onHand, balance.onHand, product?.reorderPoint ?? null);
      return { balance, lowStockCrossed };
    });
  });
}

export type ReturnFulfilledInput = {
  organizationId: string;
  caseId: string;
  productId: string;
  variantId?: string | null;
  locationId: string;
  restock: boolean; // true → back into sellable stock; false → damaged/non-restockable
  actorStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

/**
 * Returns a fulfilled item. Restock: a `return_restock` movement adds it back
 * to on-hand and the fulfillment's COGS entry is REVERSED (Dr 1300 / Cr 5100)
 * — never deleted, per accounting immutability. Non-restock: a
 * `return_damage` audit-only movement (0 units) and COGS stands (the goods
 * are gone). The case-order revenue reversal is handled separately by
 * pricingService when the merchandise line is removed from the order.
 */
export async function returnFulfilled(input: ReturnFulfilledInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<InventoryBalance> {
  const now = input.now ?? new Date().toISOString();
  const variantId = input.variantId ?? null;
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId, variantId);
  const id = reservationId(input.organizationId, input.caseId, input.productId, input.locationId, variantId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      const reservation = await findReservationById(id, dataAdapterMode);
      if (!reservation || reservation.status !== 'fulfilled') throw new InventoryServiceError('No fulfilled reservation to return.', 'not_found');
      const returnMovementId = `return-${id}`;
      const existing = await findMovementById(returnMovementId, dataAdapterMode);
      if (!existing) {
        await insertMovement({
          id: returnMovementId, organizationId: input.organizationId, productId: input.productId, variantId, locationId: input.locationId,
          quantity: input.restock ? reservation.quantity : 0, movementType: input.restock ? 'return_restock' : 'return_damage',
          caseId: input.caseId, caseOrderId: reservation.caseOrderId, reservationId: id, fulfillmentReference: reservation.fulfillmentReference, receiptReference: null, supplierName: null, purchaseOrderLineItemId: null,
          unitCost: null, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: input.restock ? 'Returned and restocked' : 'Returned, not restockable', correlationId: ctx.correlationId, createdAt: now,
        }, dataAdapterMode);
        if (input.restock) {
          const cogsEntry = await findEntryBySourceReference(input.organizationId, 'cogs', `merch-cogs-${id}`, dataAdapterMode);
          if (cogsEntry) {
            await reverseJournalEntry(input.organizationId, cogsEntry.id, { reason: `Return restock for case ${input.caseId}`, performedByStaffProfileId: input.actorStaffProfileId ?? null, idFactory: input.idFactory, now }, dataAdapterMode);
          }
        }
        await bestEffort(() => recordInventoryReturned(ctx, input.caseId, input.productId, input.locationId, reservation.quantity, input.restock, dataAdapterMode));
      }
      return recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode, variantId);
    });
  });
}

export type AdjustStockInput = {
  organizationId: string;
  productId: string;
  variantId?: string | null;
  locationId: string;
  quantityDelta: number; // signed
  movementType: Extract<InventoryMovementType, 'adjustment' | 'damage' | 'shrinkage' | 'correction'>;
  reason: string;
  actorStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function adjustStock(input: AdjustStockInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ balance: InventoryBalance; lowStockCrossed: boolean }> {
  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) throw new InventoryServiceError('Adjustment quantityDelta must be a non-zero integer.', 'invalid_input');
  if (input.reason.trim().length === 0) throw new InventoryServiceError('An adjustment requires a reason.', 'invalid_input');
  const now = input.now ?? new Date().toISOString();
  const variantId = input.variantId ?? null;
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId, variantId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      const { product, cost } = await resolveSellableCost(input.organizationId, input.productId, variantId, dataAdapterMode);
      const before = await getStockLevel(input.organizationId, input.productId, input.locationId, dataAdapterMode, variantId);
      const movementId = input.idFactory();
      await insertMovement({
        id: movementId, organizationId: input.organizationId, productId: input.productId, variantId, locationId: input.locationId, quantity: input.quantityDelta, movementType: input.movementType,
        caseId: null, caseOrderId: null, reservationId: null, fulfillmentReference: null, receiptReference: null, supplierName: null, purchaseOrderLineItemId: null,
        unitCost: cost, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: input.reason.trim(), correlationId: ctx.correlationId, createdAt: now,
      }, dataAdapterMode);
      // Value the change at the effective cost; a loss debits shrinkage.
      await postInventoryAdjustment(input.organizationId, `merch-adj-${movementId}`, input.quantityDelta * (cost ?? 0), input.actorStaffProfileId ?? null, input.idFactory, now, dataAdapterMode);
      await bestEffort(() => recordInventoryAdjusted(ctx, input.productId, input.locationId, input.quantityDelta, input.reason.trim(), dataAdapterMode));
      const balance = await recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode, variantId);
      const lowStockCrossed = crossedLowStockThreshold(before.onHand, balance.onHand, product?.reorderPoint ?? null);
      return { balance, lowStockCrossed };
    });
  });
}

export type TransferStockInput = {
  organizationId: string;
  productId: string;
  variantId?: string | null;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  actorStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function transferStock(input: TransferStockInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ from: InventoryBalance; to: InventoryBalance }> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new InventoryServiceError('Transfer quantity must be a positive integer.', 'invalid_input');
  if (input.fromLocationId === input.toLocationId) throw new InventoryServiceError('Transfer source and destination must differ.', 'invalid_input');
  const now = input.now ?? new Date().toISOString();
  const variantId = input.variantId ?? null;
  // Acquire both stock-line locks in canonical (sorted) order to avoid a
  // deadlock between two opposing transfers.
  const keyFrom = stockLineLockKey(input.organizationId, input.fromLocationId, input.productId, variantId);
  const keyTo = stockLineLockKey(input.organizationId, input.toLocationId, input.productId, variantId);
  const [first, second] = [keyFrom, keyTo].sort();

  return withInventoryLock(first, dataAdapterMode, async () =>
    withInventoryLock(second, dataAdapterMode, async () => {
      const fromLevel = await getStockLevel(input.organizationId, input.productId, input.fromLocationId, dataAdapterMode, variantId);
      if (input.quantity > fromLevel.available) throw new InventoryServiceError(`Only ${fromLevel.available} available at the source location.`, 'insufficient_stock');
      const correlationId = ctx.correlationId;
      const idSuffix = variantId ? `-${variantId}` : '';
      await insertMovement({ id: `transfer-${correlationId}-out${idSuffix}`, organizationId: input.organizationId, productId: input.productId, variantId, locationId: input.fromLocationId, quantity: -input.quantity, movementType: 'transfer_out', caseId: null, caseOrderId: null, reservationId: null, fulfillmentReference: null, receiptReference: null, supplierName: null, purchaseOrderLineItemId: null, unitCost: null, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: null, correlationId, createdAt: now }, dataAdapterMode);
      await insertMovement({ id: `transfer-${correlationId}-in${idSuffix}`, organizationId: input.organizationId, productId: input.productId, variantId, locationId: input.toLocationId, quantity: input.quantity, movementType: 'transfer_in', caseId: null, caseOrderId: null, reservationId: null, fulfillmentReference: null, receiptReference: null, supplierName: null, purchaseOrderLineItemId: null, unitCost: null, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: null, correlationId, createdAt: now }, dataAdapterMode);
      const from = await recomputeBalance(input.organizationId, input.productId, input.fromLocationId, now, dataAdapterMode, variantId);
      const to = await recomputeBalance(input.organizationId, input.productId, input.toLocationId, now, dataAdapterMode, variantId);
      await bestEffort(() => recordInventoryTransferred(ctx, input.productId, input.fromLocationId, input.toLocationId, input.quantity, dataAdapterMode));
      return { from, to };
    }),
  );
}

/**
 * Drift detection + repair: recompute a stock line's snapshot from the
 * authoritative movements + active reservations and report any difference
 * from the stored snapshot. Because normal writes already recompute inside
 * the lease, drift can only arise from the documented residual race — this is
 * how it is caught and corrected.
 */
export async function reconcileStockLine(organizationId: string, productId: string, locationId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string, variantId: string | null = null): Promise<{ before: { onHand: number; reserved: number } | null; after: InventoryBalance; drifted: boolean }> {
  const nowIso = now ?? new Date().toISOString();
  const lockKey = stockLineLockKey(organizationId, locationId, productId, variantId);
  return withInventoryLock(lockKey, dataAdapterMode, async () => {
    const id = stockBalanceId(organizationId, locationId, productId, variantId);
    const existing = dataAdapterMode === 'mock'
      ? inventoryBalanceFixtures.find((b) => b.id === id) ?? null
      : mapWixInventoryBalanceItem((await queryWixDataItems<WixInventoryBalanceItem>('inventoryBalances', { filter: { beaconInventoryBalanceId: id }, paging: { limit: 1 } })).dataItems[0]?.data);
    const before = existing ? { onHand: existing.onHand, reserved: existing.reserved } : null;
    const after = await recomputeBalance(organizationId, productId, locationId, nowIso, dataAdapterMode, variantId);
    const drifted = before === null || before.onHand !== after.onHand || before.reserved !== after.reserved;
    return { before, after, drifted };
  });
}

async function bestEffort(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error('Failed to record inventory activity event:', error instanceof Error ? error.message : error);
  }
}
