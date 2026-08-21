import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, deleteWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import {
  inventoryLockFixtures,
  inventoryWriteClaimFixtures,
  type InventoryLockRow,
  type InventoryWriteClaimRow,
} from './__mocks__/merchandiseFixtures';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). A durable, PER-STOCK-LINE
 * mutual-exclusion lease + write-claim — the exact proven construction
 * `services/organizationLockService.ts` established in Phase 22 (lease +
 * fencing token + write-claim over Wix Data's one atomic primitive:
 * unique-`_id` insert-conflict), generalized from a per-organization key to
 * a per-stock-line key. The protected key is
 * `${organizationId}-${locationId}-${productId}` (ADR-039 decision 3), so
 * concurrent operations on DIFFERENT stock lines never contend — only
 * same-(org, location, product) operations serialize.
 *
 * Why this is needed: reserving/decrementing "only if available" is a
 * read-check-write, and Wix Data offers NO conditional write / compare-and-
 * swap (confirmed empirically, ADR-026). Serializing per stock line makes
 * that read-check-write safe for every realistic scenario.
 *
 * HONEST RESIDUAL RACE (unchanged from ADR-026, now scoped to one stock
 * line): a single un-closeable gap remains between the write-claim's final
 * `assertFenceStillCurrent` check and the actual write dispatch — no client-
 * side check can close it without Wix Data supporting conditional writes.
 * MITIGATION: inventory is an append-only movement ledger
 * (`inventoryMovements`), so any drift a rare lost race could cause is
 * DETECTABLE and correctable via `inventoryService`'s reconcile routine.
 * We claim strong, honestly-bounded serialization — never perfect atomicity.
 *
 * Backed by two dedicated collections (`inventoryLocks`,
 * `inventoryWriteClaims`), each keyed `_id = lockKey`. This is the sole
 * writer of both (structural-test enforced).
 */
const LEASE_TTL_MS = 10_000;
const LEASE_RENEW_INTERVAL_MS = 3_000;
const ACQUIRE_MAX_ATTEMPTS = 40;
const ACQUIRE_RETRY_DELAY_MS = 50;
const WRITE_CLAIM_TTL_MS = 5_000;
const CLAIM_MAX_ATTEMPTS = 10;
const CLAIM_RETRY_DELAY_MS = 50;

export class InventoryLockError extends Error {}
export class InventoryLockLeaseLostError extends InventoryLockError {}

export type InventoryLockHandle = { lockKey: string; lockToken: string; fenceToken: number };

/** The protected key for one stock line. */
export function stockLineLockKey(organizationId: string, locationId: string, productId: string): string {
  return `${organizationId}-${locationId}-${productId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExpired(isoTimestamp: string, now: number): boolean {
  return new Date(isoTimestamp).getTime() < now;
}

// --- Wix row shapes (internal; these collections hold only lock state) ------

type WixInventoryLockItem = { beaconInventoryLockKey?: unknown; lockKey?: unknown; lockToken?: unknown; fenceToken?: unknown; lockedAt?: unknown; expiresAt?: unknown };
type WixInventoryWriteClaimItem = { beaconInventoryWriteClaimKey?: unknown; lockKey?: unknown; lockToken?: unknown; fenceToken?: unknown; claimedAt?: unknown; expiresAt?: unknown };

function buildLockData(row: InventoryLockRow): WixInventoryLockItem {
  return { beaconInventoryLockKey: row.lockKey, lockKey: row.lockKey, lockToken: row.lockToken, fenceToken: row.fenceToken, lockedAt: row.lockedAt, expiresAt: row.expiresAt };
}
function mapLock(item: WixInventoryLockItem | undefined): InventoryLockRow | null {
  if (!item || typeof item.lockKey !== 'string' || typeof item.lockToken !== 'string' || typeof item.fenceToken !== 'number' || typeof item.lockedAt !== 'string' || typeof item.expiresAt !== 'string') return null;
  return { id: item.lockKey, lockKey: item.lockKey, lockToken: item.lockToken, fenceToken: item.fenceToken, lockedAt: item.lockedAt, expiresAt: item.expiresAt };
}
function buildClaimData(row: InventoryWriteClaimRow): WixInventoryWriteClaimItem {
  return { beaconInventoryWriteClaimKey: row.lockKey, lockKey: row.lockKey, lockToken: row.lockToken, fenceToken: row.fenceToken, claimedAt: row.claimedAt, expiresAt: row.expiresAt };
}
function mapClaim(item: WixInventoryWriteClaimItem | undefined): InventoryWriteClaimRow | null {
  if (!item || typeof item.lockKey !== 'string' || typeof item.lockToken !== 'string' || typeof item.fenceToken !== 'number' || typeof item.claimedAt !== 'string' || typeof item.expiresAt !== 'string') return null;
  return { id: item.lockKey, lockKey: item.lockKey, lockToken: item.lockToken, fenceToken: item.fenceToken, claimedAt: item.claimedAt, expiresAt: item.expiresAt };
}

async function readLock(lockKey: string, dataAdapterMode: DataAdapterMode): Promise<InventoryLockRow | null> {
  if (dataAdapterMode === 'mock') return inventoryLockFixtures.find((l) => l.lockKey === lockKey) ?? null;
  const response = await queryWixDataItems<WixInventoryLockItem>('inventoryLocks', { filter: { lockKey }, paging: { limit: 1 } });
  return mapLock(response.dataItems[0]?.data);
}

async function readWriteClaim(lockKey: string, dataAdapterMode: DataAdapterMode): Promise<InventoryWriteClaimRow | null> {
  if (dataAdapterMode === 'mock') return inventoryWriteClaimFixtures.find((c) => c.lockKey === lockKey) ?? null;
  const response = await queryWixDataItems<WixInventoryWriteClaimItem>('inventoryWriteClaims', { filter: { lockKey }, paging: { limit: 1 } });
  return mapClaim(response.dataItems[0]?.data);
}

async function tryAcquireOnce(lockKey: string, lockToken: string, dataAdapterMode: DataAdapterMode, leaseTtlMs: number): Promise<number | null> {
  const now = Date.now();
  const lockedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + leaseTtlMs).toISOString();

  if (dataAdapterMode === 'mock') {
    // Fully synchronous — no await between check and write — so a
    // Promise.all race can never let two callers both observe "free".
    const idx = inventoryLockFixtures.findIndex((l) => l.lockKey === lockKey);
    if (idx === -1) {
      inventoryLockFixtures.push({ id: lockKey, lockKey, lockToken, fenceToken: 1, lockedAt, expiresAt });
      return 1;
    }
    const existing = inventoryLockFixtures[idx];
    if (!isExpired(existing.expiresAt, now)) return null;
    const liveClaim = inventoryWriteClaimFixtures.find((c) => c.lockKey === lockKey);
    if (liveClaim && !isExpired(liveClaim.expiresAt, now)) return null;
    const fenceToken = existing.fenceToken + 1;
    inventoryLockFixtures[idx] = { id: lockKey, lockKey, lockToken, fenceToken, lockedAt, expiresAt };
    return fenceToken;
  }

  try {
    await insertWixDataItem<WixInventoryLockItem>('inventoryLocks', buildLockData({ id: lockKey, lockKey, lockToken, fenceToken: 1, lockedAt, expiresAt }), lockKey);
    return 1;
  } catch (error) {
    if (!(error instanceof WixDataApiError) || error.status !== 409) throw error;
    const existing = await readLock(lockKey, dataAdapterMode);
    if (!existing || !isExpired(existing.expiresAt, now)) return null;
    const liveClaim = await readWriteClaim(lockKey, dataAdapterMode);
    if (liveClaim && !isExpired(liveClaim.expiresAt, now)) return null;
    const fenceToken = existing.fenceToken + 1;
    await deleteWixDataItem('inventoryLocks', lockKey);
    try {
      await insertWixDataItem<WixInventoryLockItem>('inventoryLocks', buildLockData({ id: lockKey, lockKey, lockToken, fenceToken, lockedAt, expiresAt }), lockKey);
      return fenceToken;
    } catch {
      return null;
    }
  }
}

async function acquireLock(lockKey: string, dataAdapterMode: DataAdapterMode, leaseTtlMs: number): Promise<InventoryLockHandle> {
  for (let attempt = 0; attempt < ACQUIRE_MAX_ATTEMPTS; attempt++) {
    const lockToken = crypto.randomUUID();
    const fenceToken = await tryAcquireOnce(lockKey, lockToken, dataAdapterMode, leaseTtlMs);
    if (fenceToken !== null) return { lockKey, lockToken, fenceToken };
    await sleep(ACQUIRE_RETRY_DELAY_MS);
  }
  throw new InventoryLockError('Another inventory operation is already in progress for this product/location. Please try again.');
}

async function isCurrentOwner(handle: InventoryLockHandle, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const current = await readLock(handle.lockKey, dataAdapterMode);
  return current !== null && current.lockToken === handle.lockToken && current.fenceToken === handle.fenceToken;
}

async function renewLease(handle: InventoryLockHandle, dataAdapterMode: DataAdapterMode, leaseTtlMs: number): Promise<void> {
  if (!(await isCurrentOwner(handle, dataAdapterMode))) throw new InventoryLockLeaseLostError(`Inventory lease ${handle.lockKey} was reclaimed before renewal.`);
  const expiresAt = new Date(Date.now() + leaseTtlMs).toISOString();
  if (dataAdapterMode === 'mock') {
    const idx = inventoryLockFixtures.findIndex((l) => l.lockKey === handle.lockKey);
    if (idx === -1 || inventoryLockFixtures[idx].lockToken !== handle.lockToken || inventoryLockFixtures[idx].fenceToken !== handle.fenceToken) {
      throw new InventoryLockLeaseLostError(`Inventory lease ${handle.lockKey} was reclaimed before renewal.`);
    }
    inventoryLockFixtures[idx] = { ...inventoryLockFixtures[idx], expiresAt };
    return;
  }
  const response = await queryWixDataItems<WixInventoryLockItem>('inventoryLocks', { filter: { lockKey: handle.lockKey }, paging: { limit: 1 } });
  const item = response.dataItems[0];
  const current = mapLock(item?.data);
  if (!item || !current || current.lockToken !== handle.lockToken || current.fenceToken !== handle.fenceToken) {
    throw new InventoryLockLeaseLostError(`Inventory lease ${handle.lockKey} was reclaimed before renewal.`);
  }
  await updateWixDataItem<WixInventoryLockItem>('inventoryLocks', item.id, buildLockData({ ...current, expiresAt }));
}

async function releaseLock(handle: InventoryLockHandle, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (!(await isCurrentOwner(handle, dataAdapterMode))) return;
  if (dataAdapterMode === 'mock') {
    const idx = inventoryLockFixtures.findIndex((l) => l.lockKey === handle.lockKey && l.lockToken === handle.lockToken && l.fenceToken === handle.fenceToken);
    if (idx !== -1) inventoryLockFixtures.splice(idx, 1);
    return;
  }
  await deleteWixDataItem('inventoryLocks', handle.lockKey);
}

export async function assertFenceStillCurrent(handle: InventoryLockHandle, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (!(await isCurrentOwner(handle, dataAdapterMode))) {
    throw new InventoryLockLeaseLostError(`Inventory lease ${handle.lockKey} was reclaimed — refusing to proceed with a stale lease.`);
  }
}

async function tryClaimWriteOnce(handle: InventoryLockHandle, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  if (!(await isCurrentOwner(handle, dataAdapterMode))) return false;
  const now = Date.now();
  const claimedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + WRITE_CLAIM_TTL_MS).toISOString();
  if (dataAdapterMode === 'mock') {
    const idx = inventoryWriteClaimFixtures.findIndex((c) => c.lockKey === handle.lockKey);
    if (idx !== -1 && !isExpired(inventoryWriteClaimFixtures[idx].expiresAt, now)) return false;
    if (idx !== -1) inventoryWriteClaimFixtures.splice(idx, 1);
    inventoryWriteClaimFixtures.push({ id: handle.lockKey, lockKey: handle.lockKey, lockToken: handle.lockToken, fenceToken: handle.fenceToken, claimedAt, expiresAt });
    return true;
  }
  try {
    await insertWixDataItem<WixInventoryWriteClaimItem>('inventoryWriteClaims', buildClaimData({ id: handle.lockKey, lockKey: handle.lockKey, lockToken: handle.lockToken, fenceToken: handle.fenceToken, claimedAt, expiresAt }), handle.lockKey);
    return true;
  } catch (error) {
    if (!(error instanceof WixDataApiError) || error.status !== 409) throw error;
    const existing = await readWriteClaim(handle.lockKey, dataAdapterMode);
    if (existing && !isExpired(existing.expiresAt, now)) return false;
    if (existing) await deleteWixDataItem('inventoryWriteClaims', handle.lockKey);
    try {
      await insertWixDataItem<WixInventoryWriteClaimItem>('inventoryWriteClaims', buildClaimData({ id: handle.lockKey, lockKey: handle.lockKey, lockToken: handle.lockToken, fenceToken: handle.fenceToken, claimedAt, expiresAt }), handle.lockKey);
      return true;
    } catch {
      return false;
    }
  }
}

async function releaseWriteClaim(handle: InventoryLockHandle, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const idx = inventoryWriteClaimFixtures.findIndex((c) => c.lockKey === handle.lockKey && c.lockToken === handle.lockToken && c.fenceToken === handle.fenceToken);
    if (idx !== -1) inventoryWriteClaimFixtures.splice(idx, 1);
    return;
  }
  const existing = await readWriteClaim(handle.lockKey, dataAdapterMode);
  if (existing && existing.lockToken === handle.lockToken && existing.fenceToken === handle.fenceToken) {
    await deleteWixDataItem('inventoryWriteClaims', handle.lockKey);
  }
}

/** Route the actual stock-mutating persistence through this — structurally
    blocks a lease reclaim while `performWrite` runs (see this module's
    comment for the mechanism and its honest limit). */
export async function commitProtectedWrite<T>(handle: InventoryLockHandle, dataAdapterMode: DataAdapterMode, performWrite: () => Promise<T>): Promise<T> {
  let claimed = false;
  for (let attempt = 0; attempt < CLAIM_MAX_ATTEMPTS; attempt++) {
    if (await tryClaimWriteOnce(handle, dataAdapterMode)) {
      claimed = true;
      break;
    }
    if (!(await isCurrentOwner(handle, dataAdapterMode))) {
      throw new InventoryLockLeaseLostError(`Inventory lease ${handle.lockKey} was reclaimed before a write claim could be taken.`);
    }
    await sleep(CLAIM_RETRY_DELAY_MS);
  }
  if (!claimed) throw new InventoryLockLeaseLostError(`Could not claim the write slot for ${handle.lockKey} — another write did not release in time.`);
  try {
    await assertFenceStillCurrent(handle, dataAdapterMode);
    return await performWrite();
  } finally {
    await releaseWriteClaim(handle, dataAdapterMode);
  }
}

/** Runs `fn` holding the exclusive per-stock-line lease, heartbeat-renewed.
    `fn` receives the handle for its own `commitProtectedWrite`. A lost lease
    fails the whole call closed (`InventoryLockLeaseLostError`), even if `fn`
    already produced a result — it can no longer be trusted as exclusive. */
export async function withInventoryLock<T>(
  lockKey: string,
  dataAdapterMode: DataAdapterMode,
  fn: (handle: InventoryLockHandle) => Promise<T>,
  options?: { leaseTtlMs?: number; renewIntervalMs?: number },
): Promise<T> {
  const leaseTtlMs = options?.leaseTtlMs ?? LEASE_TTL_MS;
  const renewIntervalMs = options?.renewIntervalMs ?? LEASE_RENEW_INTERVAL_MS;
  const handle = await acquireLock(lockKey, dataAdapterMode, leaseTtlMs);

  let leaseLost: Error | null = null;
  const renewalTimer = setInterval(() => {
    renewLease(handle, dataAdapterMode, leaseTtlMs).catch((error) => {
      leaseLost = error instanceof Error ? error : new InventoryLockLeaseLostError(String(error));
    });
  }, renewIntervalMs);
  if (typeof renewalTimer === 'object' && 'unref' in renewalTimer) {
    (renewalTimer as { unref: () => void }).unref();
  }

  try {
    const result = await fn(handle);
    if (leaseLost) throw leaseLost;
    return result;
  } finally {
    clearInterval(renewalTimer);
    await releaseLock(handle, dataAdapterMode);
  }
}
