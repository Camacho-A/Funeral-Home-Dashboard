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
import { getProductById } from './merchandiseService';
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

async function listMovementsForStockLine(organizationId: string, productId: string, locationId: string, dataAdapterMode: DataAdapterMode): Promise<InventoryMovement[]> {
  if (dataAdapterMode === 'mock') {
    return inventoryMovementFixtures.filter((m) => m.organizationId === organizationId && m.productId === productId && m.locationId === locationId);
  }
  const response = await queryWixDataItems<WixInventoryMovementItem>('inventoryMovements', { filter: { organizationId, productId, locationId } });
  return response.dataItems.map((i) => mapWixInventoryMovementItem(i.data)).filter((m): m is InventoryMovement => m !== null);
}

async function findMovementById(id: string, dataAdapterMode: DataAdapterMode): Promise<InventoryMovement | null> {
  if (dataAdapterMode === 'mock') return inventoryMovementFixtures.find((m) => m.id === id) ?? null;
  const response = await queryWixDataItems<WixInventoryMovementItem>('inventoryMovements', { filter: { beaconInventoryMovementId: id }, paging: { limit: 1 } });
  return mapWixInventoryMovementItem(response.dataItems[0]?.data);
}

async function listActiveReservationsForStockLine(organizationId: string, productId: string, locationId: string, dataAdapterMode: DataAdapterMode): Promise<InventoryReservation[]> {
  if (dataAdapterMode === 'mock') {
    return inventoryReservationFixtures.filter((r) => r.organizationId === organizationId && r.productId === productId && r.locationId === locationId && r.status === 'active');
  }
  const response = await queryWixDataItems<WixInventoryReservationItem>('inventoryReservations', { filter: { organizationId, productId, locationId, status: 'active' } });
  return response.dataItems.map((i) => mapWixInventoryReservationItem(i.data)).filter((r): r is InventoryReservation => r !== null);
}

async function findReservationById(id: string, dataAdapterMode: DataAdapterMode): Promise<InventoryReservation | null> {
  if (dataAdapterMode === 'mock') return inventoryReservationFixtures.find((r) => r.id === id) ?? null;
  const response = await queryWixDataItems<WixInventoryReservationItem>('inventoryReservations', { filter: { beaconInventoryReservationId: id }, paging: { limit: 1 } });
  return mapWixInventoryReservationItem(response.dataItems[0]?.data);
}

function reservationId(organizationId: string, caseId: string, productId: string, locationId: string): string {
  return `${organizationId}-${caseId}-${productId}-${locationId}`;
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
async function recomputeBalance(organizationId: string, productId: string, locationId: string, now: string, dataAdapterMode: DataAdapterMode): Promise<InventoryBalance> {
  const movements = await listMovementsForStockLine(organizationId, productId, locationId, dataAdapterMode);
  const reservations = await listActiveReservationsForStockLine(organizationId, productId, locationId, dataAdapterMode);
  const onHand = movements.reduce((sum, m) => sum + m.quantity, 0);
  const reserved = reservations.reduce((sum, r) => sum + r.quantity, 0);
  const id = `${organizationId}-${locationId}-${productId}`;
  const balance: InventoryBalance = { id, organizationId, productId, locationId, onHand, reserved, updatedAt: now };

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

export type StockLevel = { productId: string; locationId: string; onHand: number; reserved: number; available: number };

export async function getStockLevel(organizationId: string, productId: string, locationId: string, dataAdapterMode: DataAdapterMode): Promise<StockLevel> {
  const movements = await listMovementsForStockLine(organizationId, productId, locationId, dataAdapterMode);
  const reservations = await listActiveReservationsForStockLine(organizationId, productId, locationId, dataAdapterMode);
  const onHand = movements.reduce((sum, m) => sum + m.quantity, 0);
  const reserved = reservations.reduce((sum, r) => sum + r.quantity, 0);
  return { productId, locationId, onHand, reserved, available: availableUnits(onHand, reserved) };
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
  locationId: string;
  quantity: number;
  unitCost: number; // cents
  supplierName?: string | null;
  receiptReference: string; // idempotency anchor
  actorStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function receiveStock(input: ReceiveStockInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ movement: InventoryMovement | null; balance: InventoryBalance }> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new InventoryServiceError('Receiving quantity must be a positive integer.', 'invalid_input');
  if (!Number.isInteger(input.unitCost) || input.unitCost < 0) throw new InventoryServiceError('unitCost must be a non-negative integer number of cents.', 'invalid_input');
  const now = input.now ?? new Date().toISOString();
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    const movementId = `receive-${input.receiptReference}-${input.productId}-${input.locationId}`;
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      let movement: InventoryMovement | null = await findMovementById(movementId, dataAdapterMode);
      if (!movement) {
        movement = await insertMovement({
          id: movementId,
          organizationId: input.organizationId,
          productId: input.productId,
          locationId: input.locationId,
          quantity: input.quantity,
          movementType: 'receiving',
          caseId: null,
          caseOrderId: null,
          reservationId: null,
          fulfillmentReference: null,
          receiptReference: input.receiptReference,
          supplierName: input.supplierName ?? null,
          unitCost: input.unitCost,
          actorStaffProfileId: input.actorStaffProfileId ?? null,
          reason: null,
          correlationId: ctx.correlationId,
          createdAt: now,
        }, dataAdapterMode);
        await postInventoryReceipt(input.organizationId, `merch-recv-${movementId}`, input.unitCost * input.quantity, input.actorStaffProfileId ?? null, input.idFactory, now, dataAdapterMode);
        await bestEffort(() => recordInventoryReceived(ctx, input.productId, input.locationId, input.quantity, dataAdapterMode));
      }
      const balance = await recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode);
      return { movement, balance };
    });
  });
}

export type SyncReservationInput = {
  organizationId: string;
  caseId: string;
  caseOrderId: string;
  productId: string;
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
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId);
  const id = reservationId(input.organizationId, input.caseId, input.productId, input.locationId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      const level = await getStockLevel(input.organizationId, input.productId, input.locationId, dataAdapterMode);
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
        : { id, organizationId: input.organizationId, caseId: input.caseId, caseOrderId: input.caseOrderId, productId: input.productId, locationId: input.locationId, quantity: input.quantity, status, fulfillmentReference: null, createdAt: now, updatedAt: now };
      await upsertReservation(reservation, dataAdapterMode);
      const balance = await recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode);

      const delta = input.quantity - currentHold;
      if (delta > 0) await bestEffort(() => recordInventoryReserved(ctx, input.caseId, input.productId, input.locationId, delta, dataAdapterMode));
      else if (delta < 0) await bestEffort(() => recordInventoryReleased(ctx, input.caseId, input.productId, input.locationId, -delta, dataAdapterMode));
      return { reservation, balance };
    });
  });
}

export async function releaseReservation(organizationId: string, caseId: string, productId: string, locationId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string): Promise<InventoryBalance> {
  const result = await syncReservation({ organizationId, caseId, caseOrderId: '', productId, locationId, quantity: 0, idFactory: () => crypto.randomUUID(), now }, ctx, dataAdapterMode);
  return result.balance;
}

export type FulfillReservationInput = {
  organizationId: string;
  caseId: string;
  productId: string;
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
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId);
  const id = reservationId(input.organizationId, input.caseId, input.productId, input.locationId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      const reservation = await findReservationById(id, dataAdapterMode);
      if (!reservation || reservation.status !== 'active') throw new InventoryServiceError('No active reservation to fulfill.', 'not_found');
      const product = await getProductById(input.organizationId, input.productId, dataAdapterMode);

      const before = await getStockLevel(input.organizationId, input.productId, input.locationId, dataAdapterMode);
      const fulfillmentReference = `fulfill-${id}`;
      const saleMovementId = `sale-${id}`;
      const existingSale = await findMovementById(saleMovementId, dataAdapterMode);
      if (!existingSale) {
        await insertMovement({
          id: saleMovementId, organizationId: input.organizationId, productId: input.productId, locationId: input.locationId, quantity: -reservation.quantity, movementType: 'sale',
          caseId: input.caseId, caseOrderId: reservation.caseOrderId, reservationId: id, fulfillmentReference, receiptReference: null, supplierName: null,
          unitCost: product?.cost ?? null, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: null, correlationId: ctx.correlationId, createdAt: now,
        }, dataAdapterMode);
      }
      await upsertReservation({ ...reservation, status: 'fulfilled', fulfillmentReference, updatedAt: now }, dataAdapterMode);
      await postCogs(input.organizationId, input.caseId, `merch-cogs-${id}`, (product?.cost ?? 0) * reservation.quantity, input.actorStaffProfileId ?? null, input.idFactory, now, dataAdapterMode);
      await bestEffort(() => recordInventoryFulfilled(ctx, input.caseId, input.productId, input.locationId, reservation.quantity, dataAdapterMode));

      const balance = await recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode);
      const lowStockCrossed = crossedLowStockThreshold(before.onHand, balance.onHand, product?.reorderPoint ?? null);
      return { balance, lowStockCrossed };
    });
  });
}

export type ReturnFulfilledInput = {
  organizationId: string;
  caseId: string;
  productId: string;
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
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId);
  const id = reservationId(input.organizationId, input.caseId, input.productId, input.locationId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      const reservation = await findReservationById(id, dataAdapterMode);
      if (!reservation || reservation.status !== 'fulfilled') throw new InventoryServiceError('No fulfilled reservation to return.', 'not_found');
      const returnMovementId = `return-${id}`;
      const existing = await findMovementById(returnMovementId, dataAdapterMode);
      if (!existing) {
        await insertMovement({
          id: returnMovementId, organizationId: input.organizationId, productId: input.productId, locationId: input.locationId,
          quantity: input.restock ? reservation.quantity : 0, movementType: input.restock ? 'return_restock' : 'return_damage',
          caseId: input.caseId, caseOrderId: reservation.caseOrderId, reservationId: id, fulfillmentReference: reservation.fulfillmentReference, receiptReference: null, supplierName: null,
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
      return recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode);
    });
  });
}

export type AdjustStockInput = {
  organizationId: string;
  productId: string;
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
  const lockKey = stockLineLockKey(input.organizationId, input.locationId, input.productId);

  return withInventoryLock(lockKey, dataAdapterMode, async (handle) => {
    return commitProtectedWrite(handle, dataAdapterMode, async () => {
      const product = await getProductById(input.organizationId, input.productId, dataAdapterMode);
      const before = await getStockLevel(input.organizationId, input.productId, input.locationId, dataAdapterMode);
      const movementId = input.idFactory();
      await insertMovement({
        id: movementId, organizationId: input.organizationId, productId: input.productId, locationId: input.locationId, quantity: input.quantityDelta, movementType: input.movementType,
        caseId: null, caseOrderId: null, reservationId: null, fulfillmentReference: null, receiptReference: null, supplierName: null,
        unitCost: product?.cost ?? null, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: input.reason.trim(), correlationId: ctx.correlationId, createdAt: now,
      }, dataAdapterMode);
      // Value the change at the product's cost; a loss debits shrinkage.
      await postInventoryAdjustment(input.organizationId, `merch-adj-${movementId}`, input.quantityDelta * (product?.cost ?? 0), input.actorStaffProfileId ?? null, input.idFactory, now, dataAdapterMode);
      await bestEffort(() => recordInventoryAdjusted(ctx, input.productId, input.locationId, input.quantityDelta, input.reason.trim(), dataAdapterMode));
      const balance = await recomputeBalance(input.organizationId, input.productId, input.locationId, now, dataAdapterMode);
      const lowStockCrossed = crossedLowStockThreshold(before.onHand, balance.onHand, product?.reorderPoint ?? null);
      return { balance, lowStockCrossed };
    });
  });
}

export type TransferStockInput = {
  organizationId: string;
  productId: string;
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
  // Acquire both stock-line locks in canonical (sorted) order to avoid a
  // deadlock between two opposing transfers.
  const keyFrom = stockLineLockKey(input.organizationId, input.fromLocationId, input.productId);
  const keyTo = stockLineLockKey(input.organizationId, input.toLocationId, input.productId);
  const [first, second] = [keyFrom, keyTo].sort();

  return withInventoryLock(first, dataAdapterMode, async () =>
    withInventoryLock(second, dataAdapterMode, async () => {
      const fromLevel = await getStockLevel(input.organizationId, input.productId, input.fromLocationId, dataAdapterMode);
      if (input.quantity > fromLevel.available) throw new InventoryServiceError(`Only ${fromLevel.available} available at the source location.`, 'insufficient_stock');
      const correlationId = ctx.correlationId;
      await insertMovement({ id: `transfer-${correlationId}-out`, organizationId: input.organizationId, productId: input.productId, locationId: input.fromLocationId, quantity: -input.quantity, movementType: 'transfer_out', caseId: null, caseOrderId: null, reservationId: null, fulfillmentReference: null, receiptReference: null, supplierName: null, unitCost: null, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: null, correlationId, createdAt: now }, dataAdapterMode);
      await insertMovement({ id: `transfer-${correlationId}-in`, organizationId: input.organizationId, productId: input.productId, locationId: input.toLocationId, quantity: input.quantity, movementType: 'transfer_in', caseId: null, caseOrderId: null, reservationId: null, fulfillmentReference: null, receiptReference: null, supplierName: null, unitCost: null, actorStaffProfileId: input.actorStaffProfileId ?? null, reason: null, correlationId, createdAt: now }, dataAdapterMode);
      const from = await recomputeBalance(input.organizationId, input.productId, input.fromLocationId, now, dataAdapterMode);
      const to = await recomputeBalance(input.organizationId, input.productId, input.toLocationId, now, dataAdapterMode);
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
export async function reconcileStockLine(organizationId: string, productId: string, locationId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string): Promise<{ before: { onHand: number; reserved: number } | null; after: InventoryBalance; drifted: boolean }> {
  const nowIso = now ?? new Date().toISOString();
  const lockKey = stockLineLockKey(organizationId, locationId, productId);
  return withInventoryLock(lockKey, dataAdapterMode, async () => {
    const id = `${organizationId}-${locationId}-${productId}`;
    const existing = dataAdapterMode === 'mock'
      ? inventoryBalanceFixtures.find((b) => b.id === id) ?? null
      : mapWixInventoryBalanceItem((await queryWixDataItems<WixInventoryBalanceItem>('inventoryBalances', { filter: { beaconInventoryBalanceId: id }, paging: { limit: 1 } })).dataItems[0]?.data);
    const before = existing ? { onHand: existing.onHand, reserved: existing.reserved } : null;
    const after = await recomputeBalance(organizationId, productId, locationId, nowIso, dataAdapterMode);
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
