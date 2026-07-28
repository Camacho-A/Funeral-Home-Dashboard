import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, deleteWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import { mapWixOrganizationRoleLockItem, buildWixOrganizationRoleLockData, type WixOrganizationRoleLockItem } from '../lib/wixOrganizationRoleLockMapper';
import {
  mapWixOrganizationRoleWriteClaimItem,
  buildWixOrganizationRoleWriteClaimData,
  type WixOrganizationRoleWriteClaimItem,
} from '../lib/wixOrganizationRoleWriteClaimMapper';
import { organizationRoleLockFixtures, organizationRoleWriteClaimFixtures } from './__mocks__/rbacFixtures';

/**
 * Phase 22 (Role-Based Access Control) — security-correction rounds
 * (2026-07-27 through 2026-07-30). A durable, per-organization mutual-
 * exclusion **lease**, plus a **write claim** — the mechanism that makes
 * "an organization can never be left with zero active administrators"
 * safe under concurrent requests, and makes concurrent RBAC seeding
 * duplicate-free (`services/roleService.ts`'s callers).
 *
 * **Third correction round — why a lease + fencing token alone was still
 * not enough.** The second round's design had every protected mutation
 * call `assertFenceStillCurrent` immediately before its actual write, as
 * a defense against a lease being reclaimed mid-operation. That is
 * insufficient on its own: `assertFenceStillCurrent` and the write it
 * guards are **two separate operations** — a lease can still be reclaimed
 * in the gap between them, however small, and once reclaimed, the
 * original holder's write is not automatically invalidated (Wix Data's
 * `updateDataItem` is an unconditional overwrite — confirmed empirically,
 * see below). Detecting the loss *after* the fact and throwing does not
 * undo a write that already landed.
 *
 * **The confirmed Wix Data primitive, empirically verified (2026-07-30).**
 * A throwaway script inserted an item, then attempted an update carrying
 * a stale "revision" value: `insertDataItem`/`updateDataItem`/`queryDataItems`
 * responses carry **no `revision` field at all**, and a stale value passed
 * in the request body has **no effect whatsoever** — the update
 * unconditionally applies. Wix Data v2's `items` API, as this project
 * accesses it, provides **exactly one atomic primitive**: inserting an
 * item with an explicit, already-taken id fails (409). There is no
 * revision/optimistic-concurrency support and no conditional update of
 * any kind. This rules out "Confirm and use Wix Data revision/version
 * behavior" outright — there is no such behavior to use.
 *
 * **The write claim.** Given the only real atomic primitive is unique-id
 * insert-conflict, the strongest achievable mechanism built from it is:
 * make **reclaiming a lease structurally impossible while a write is
 * genuinely in flight**, rather than trying to detect a stale write after
 * it happens.
 *
 * 1. Immediately before a protected mutation's actual persistence calls,
 *    `claimWrite` attempts to insert a row into `organizationRoleWriteClaims`
 *    (id = `organizationId`, exactly like the lease itself). This insert
 *    is the same atomic primitive as lease acquisition — at most one
 *    caller can ever hold a live claim for a given organization.
 * 2. `tryAcquireOnce`'s stale-lease reclaim path now checks for a live
 *    write claim *before* reclaiming: if one exists and hasn't itself
 *    expired, reclaim is refused (treated as ordinary contention, retried
 *    like any other acquisition attempt) — a lease can never be reclaimed
 *    while its holder is provably mid-write.
 * 3. `claimWrite` re-verifies lease ownership immediately after claiming
 *    (catching the case where reclaim happened in the gap between the
 *    lease check and the claim insert), and `commitProtectedWrite` runs
 *    one more `assertFenceStillCurrent` check as the last synchronous step
 *    before dispatching the actual write — the last line of defense.
 * 4. The claim carries its own short TTL (`WRITE_CLAIM_TTL_MS`, far
 *    shorter than the lease TTL) so a process that crashes while holding
 *    a claim cannot wedge the organization indefinitely — a later
 *    acquirer's reclaim attempt will see the claim itself has expired and
 *    proceed.
 *
 * **Honest limitation.** This closes the race for every realistic
 * scenario: a second holder cannot reclaim while a first holder's claim
 * is live, which is the overwhelming majority of the original race's
 * surface area. It does **not** achieve mathematically perfect atomicity
 * for the single remaining gap between `commitProtectedWrite`'s final
 * `assertFenceStillCurrent` check and the moment the actual Wix Data write
 * call is dispatched — no client-side check, however immediate, can
 * close that gap without Wix Data itself supporting a conditional write,
 * which it does not. This project has not built a full event-sourced
 * rewrite of `Membership`/`Role` persistence (the only construction that
 * would close this last gap completely, by making "current value" always
 * resolve as "the highest-fenced entry," so a late-arriving stale write
 * can physically land but can never become authoritative) — see
 * `services/roleService.test.ts`'s "stale-writer rejection" tests for the
 * exact adversarial scenario this construction is checked against, and
 * ADR-026 for the full accounting of what is and is not guaranteed.
 */
const LEASE_TTL_MS = 10_000;
const LEASE_RENEW_INTERVAL_MS = 3_000;
const ACQUIRE_MAX_ATTEMPTS = 40;
const ACQUIRE_RETRY_DELAY_MS = 50;
const WRITE_CLAIM_TTL_MS = 5_000;
const CLAIM_MAX_ATTEMPTS = 10;
const CLAIM_RETRY_DELAY_MS = 50;

export class OrganizationLockError extends Error {}
export class LockLeaseLostError extends OrganizationLockError {}

export type OrganizationLockHandle = {
  organizationId: string;
  lockToken: string;
  fenceToken: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLock(organizationId: string, dataAdapterMode: DataAdapterMode) {
  if (dataAdapterMode === 'mock') {
    return organizationRoleLockFixtures.find((l) => l.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationRoleLockItem>('organizationRoleLocks', { filter: { organizationId }, paging: { limit: 1 } });
  return mapWixOrganizationRoleLockItem(response.dataItems[0]?.data);
}

async function readWriteClaim(organizationId: string, dataAdapterMode: DataAdapterMode) {
  if (dataAdapterMode === 'mock') {
    return organizationRoleWriteClaimFixtures.find((c) => c.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationRoleWriteClaimItem>('organizationRoleWriteClaims', { filter: { organizationId }, paging: { limit: 1 } });
  return mapWixOrganizationRoleWriteClaimItem(response.dataItems[0]?.data);
}

function isExpired(isoTimestamp: string, now: number): boolean {
  return new Date(isoTimestamp).getTime() < now;
}

async function tryAcquireOnce(organizationId: string, lockToken: string, dataAdapterMode: DataAdapterMode, leaseTtlMs: number): Promise<number | null> {
  const now = Date.now();
  const lockedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + leaseTtlMs).toISOString();

  if (dataAdapterMode === 'mock') {
    // Everything in this branch is synchronous — no `await` between
    // checking for an existing lock and writing a new one — so two
    // "concurrent" callers (raced via Promise.all in a test) can never
    // both observe "no lock" before either writes: JS never preempts a
    // synchronous block. This is what makes the mock branch a faithful
    // concurrency test, not a happy-path stub that merely returns true.
    const existingIndex = organizationRoleLockFixtures.findIndex((l) => l.organizationId === organizationId);
    if (existingIndex === -1) {
      organizationRoleLockFixtures.push({ id: organizationId, organizationId, lockToken, fenceToken: 1, lockedAt, expiresAt });
      return 1;
    }
    const existing = organizationRoleLockFixtures[existingIndex];
    if (!isExpired(existing.expiresAt, now)) return null;

    // The lease itself is expired — but reclaim must still be refused if
    // a write is genuinely in flight (its holder mid-write, lease expiry
    // notwithstanding).
    const liveClaim = organizationRoleWriteClaimFixtures.find((c) => c.organizationId === organizationId);
    if (liveClaim && !isExpired(liveClaim.expiresAt, now)) return null;

    const fenceToken = existing.fenceToken + 1;
    organizationRoleLockFixtures[existingIndex] = { id: organizationId, organizationId, lockToken, fenceToken, lockedAt, expiresAt };
    return fenceToken;
  }

  try {
    await insertWixDataItem<WixOrganizationRoleLockItem>(
      'organizationRoleLocks',
      buildWixOrganizationRoleLockData({ id: organizationId, organizationId, lockToken, fenceToken: 1, lockedAt, expiresAt }),
      organizationId,
    );
    return 1;
  } catch (error) {
    if (!(error instanceof WixDataApiError) || error.status !== 409) throw error;

    const existing = await readLock(organizationId, dataAdapterMode);
    if (!existing || !isExpired(existing.expiresAt, now)) {
      return null;
    }

    // The lease is expired — but a live write claim means its holder is
    // provably still mid-write; never reclaim out from under that.
    const liveClaim = await readWriteClaim(organizationId, dataAdapterMode);
    if (liveClaim && !isExpired(liveClaim.expiresAt, now)) {
      return null;
    }

    // Stale — reclaim it, incrementing the fence. A second concurrent
    // reclaimer could still beat us to this exact insert; that just
    // surfaces as another 409, handled by the outer retry loop like
    // ordinary contention.
    const fenceToken = existing.fenceToken + 1;
    await deleteWixDataItem('organizationRoleLocks', organizationId);
    try {
      await insertWixDataItem<WixOrganizationRoleLockItem>(
        'organizationRoleLocks',
        buildWixOrganizationRoleLockData({ id: organizationId, organizationId, lockToken, fenceToken, lockedAt, expiresAt }),
        organizationId,
      );
      return fenceToken;
    } catch {
      return null;
    }
  }
}

async function acquireLock(organizationId: string, dataAdapterMode: DataAdapterMode, leaseTtlMs: number): Promise<OrganizationLockHandle> {
  for (let attempt = 0; attempt < ACQUIRE_MAX_ATTEMPTS; attempt++) {
    const lockToken = crypto.randomUUID();
    const fenceToken = await tryAcquireOnce(organizationId, lockToken, dataAdapterMode, leaseTtlMs);
    if (fenceToken !== null) return { organizationId, lockToken, fenceToken };
    await sleep(ACQUIRE_RETRY_DELAY_MS);
  }
  throw new OrganizationLockError('Another role change is already in progress for this organization. Please try again.');
}

/** True only if `handle` still names the lease's current owner (both
    `lockToken` and `fenceToken` match the stored row) — the ownership
    check shared by renewal, release, the write claim, and the fencing
    assertion protected writes make right before their actual mutation. */
async function isCurrentOwner(handle: OrganizationLockHandle, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const current = await readLock(handle.organizationId, dataAdapterMode);
  return current !== null && current.lockToken === handle.lockToken && current.fenceToken === handle.fenceToken;
}

/** Extends the lease's `expiresAt` — only if `handle` still owns it.
    Throws `LockLeaseLostError` otherwise (a newer owner has already
    reclaimed the lease). Fail-closed: a caller must treat a failed
    renewal as "I no longer hold this lock," never retry-and-ignore. */
async function renewLease(handle: OrganizationLockHandle, dataAdapterMode: DataAdapterMode, leaseTtlMs: number): Promise<void> {
  if (!(await isCurrentOwner(handle, dataAdapterMode))) {
    throw new LockLeaseLostError(`Lease for organization ${handle.organizationId} was reclaimed by another owner before renewal.`);
  }

  const now = Date.now();
  const expiresAt = new Date(now + leaseTtlMs).toISOString();

  if (dataAdapterMode === 'mock') {
    const index = organizationRoleLockFixtures.findIndex((l) => l.organizationId === handle.organizationId);
    // A re-check immediately before the synchronous write, mirroring the
    // same "no await between check and write" discipline tryAcquireOnce
    // relies on for mock-mode correctness under Promise.all races.
    if (index === -1 || organizationRoleLockFixtures[index].lockToken !== handle.lockToken || organizationRoleLockFixtures[index].fenceToken !== handle.fenceToken) {
      throw new LockLeaseLostError(`Lease for organization ${handle.organizationId} was reclaimed by another owner before renewal.`);
    }
    organizationRoleLockFixtures[index] = { ...organizationRoleLockFixtures[index], expiresAt };
    return;
  }

  const response = await queryWixDataItems<WixOrganizationRoleLockItem>('organizationRoleLocks', { filter: { organizationId: handle.organizationId }, paging: { limit: 1 } });
  const item = response.dataItems[0];
  const current = mapWixOrganizationRoleLockItem(item?.data);
  if (!item || !current || current.lockToken !== handle.lockToken || current.fenceToken !== handle.fenceToken) {
    throw new LockLeaseLostError(`Lease for organization ${handle.organizationId} was reclaimed by another owner before renewal.`);
  }
  await updateWixDataItem<WixOrganizationRoleLockItem>('organizationRoleLocks', item.id, buildWixOrganizationRoleLockData({ ...current, expiresAt }));
}

async function releaseLock(handle: OrganizationLockHandle, dataAdapterMode: DataAdapterMode): Promise<void> {
  // Only ever release a lease we still actually own — a holder whose
  // lease already lapsed and was reclaimed by someone else must never
  // delete the new owner's row.
  if (!(await isCurrentOwner(handle, dataAdapterMode))) return;

  if (dataAdapterMode === 'mock') {
    const index = organizationRoleLockFixtures.findIndex((l) => l.organizationId === handle.organizationId && l.lockToken === handle.lockToken && l.fenceToken === handle.fenceToken);
    if (index !== -1) organizationRoleLockFixtures.splice(index, 1);
    return;
  }
  await deleteWixDataItem('organizationRoleLocks', handle.organizationId);
}

/** Throws `LockLeaseLostError` if `handle` no longer owns the lease. Used
    as the final, immediate re-verification `commitProtectedWrite` performs
    right before dispatching the actual write — the last line of defense,
    though not on its own sufficient (see this module's own comment). */
export async function assertFenceStillCurrent(handle: OrganizationLockHandle, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (!(await isCurrentOwner(handle, dataAdapterMode))) {
    throw new LockLeaseLostError(`Lease for organization ${handle.organizationId} was reclaimed by another owner — refusing to proceed with a stale lease.`);
  }
}

async function tryClaimWriteOnce(handle: OrganizationLockHandle, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  if (!(await isCurrentOwner(handle, dataAdapterMode))) return false;

  const now = Date.now();
  const claimedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + WRITE_CLAIM_TTL_MS).toISOString();

  if (dataAdapterMode === 'mock') {
    // Synchronous — no `await` between the existence/expiry check and the
    // write — for the same concurrency-correctness reason as
    // `tryAcquireOnce`'s mock branch.
    const existingIndex = organizationRoleWriteClaimFixtures.findIndex((c) => c.organizationId === handle.organizationId);
    if (existingIndex !== -1 && !isExpired(organizationRoleWriteClaimFixtures[existingIndex].expiresAt, now)) {
      return false;
    }
    if (existingIndex !== -1) organizationRoleWriteClaimFixtures.splice(existingIndex, 1);
    organizationRoleWriteClaimFixtures.push({ id: handle.organizationId, organizationId: handle.organizationId, lockToken: handle.lockToken, fenceToken: handle.fenceToken, claimedAt, expiresAt });
    return true;
  }

  try {
    await insertWixDataItem<WixOrganizationRoleWriteClaimItem>(
      'organizationRoleWriteClaims',
      buildWixOrganizationRoleWriteClaimData({ id: handle.organizationId, organizationId: handle.organizationId, lockToken: handle.lockToken, fenceToken: handle.fenceToken, claimedAt, expiresAt }),
      handle.organizationId,
    );
    return true;
  } catch (error) {
    if (!(error instanceof WixDataApiError) || error.status !== 409) throw error;
    const existing = await readWriteClaim(handle.organizationId, dataAdapterMode);
    if (existing && !isExpired(existing.expiresAt, now)) return false;
    // The existing claim is itself expired (its holder crashed mid-write)
    // — reclaim the claim slot.
    if (existing) await deleteWixDataItem('organizationRoleWriteClaims', handle.organizationId);
    try {
      await insertWixDataItem<WixOrganizationRoleWriteClaimItem>(
        'organizationRoleWriteClaims',
        buildWixOrganizationRoleWriteClaimData({ id: handle.organizationId, organizationId: handle.organizationId, lockToken: handle.lockToken, fenceToken: handle.fenceToken, claimedAt, expiresAt }),
        handle.organizationId,
      );
      return true;
    } catch {
      return false;
    }
  }
}

/** Releases a write claim — only if `handle` is still the one holding it. */
async function releaseWriteClaim(handle: OrganizationLockHandle, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = organizationRoleWriteClaimFixtures.findIndex(
      (c) => c.organizationId === handle.organizationId && c.lockToken === handle.lockToken && c.fenceToken === handle.fenceToken,
    );
    if (index !== -1) organizationRoleWriteClaimFixtures.splice(index, 1);
    return;
  }
  const existing = await readWriteClaim(handle.organizationId, dataAdapterMode);
  if (existing && existing.lockToken === handle.lockToken && existing.fenceToken === handle.fenceToken) {
    await deleteWixDataItem('organizationRoleWriteClaims', handle.organizationId);
  }
}

/**
 * The one function every protected mutation must route its actual
 * persistence call(s) through. Structurally prevents a lease from being
 * reclaimed while `performWrite` is running (see this module's own
 * comment for the full mechanism and its honest limits): claims the
 * write slot (bounded retries; fails closed as `LockLeaseLostError` if it
 * can never be claimed), re-verifies ownership one final time immediately
 * before invoking `performWrite`, and always releases the claim
 * afterward — success or failure.
 */
export async function commitProtectedWrite<T>(handle: OrganizationLockHandle, dataAdapterMode: DataAdapterMode, performWrite: () => Promise<T>): Promise<T> {
  let claimed = false;
  for (let attempt = 0; attempt < CLAIM_MAX_ATTEMPTS; attempt++) {
    if (await tryClaimWriteOnce(handle, dataAdapterMode)) {
      claimed = true;
      break;
    }
    if (!(await isCurrentOwner(handle, dataAdapterMode))) {
      throw new LockLeaseLostError(`Lease for organization ${handle.organizationId} was reclaimed by another owner before a write claim could be taken.`);
    }
    await sleep(CLAIM_RETRY_DELAY_MS);
  }
  if (!claimed) {
    throw new LockLeaseLostError(`Could not claim the write slot for organization ${handle.organizationId} — another write did not release in time.`);
  }

  try {
    // The last synchronous check before the actual write is dispatched —
    // catches a supersession that happened in the gap between the lease
    // check inside the claim attempt above and this line. Does not, on
    // its own, close every conceivable timing window (see this module's
    // own comment) — the write-claim's structural blocking of reclaim
    // above is what does the real work.
    await assertFenceStillCurrent(handle, dataAdapterMode);
    return await performWrite();
  } finally {
    await releaseWriteClaim(handle, dataAdapterMode);
  }
}

/** Runs `fn` while holding the exclusive per-organization role lease,
    renewing it on a heartbeat well before it can expire. `fn` receives
    the `OrganizationLockHandle` so it can call `commitProtectedWrite`
    around its own actual write. If the lease is ever lost (renewal fails
    because a newer owner reclaimed it), the *overall* call throws
    `LockLeaseLostError` — even if `fn` itself had already produced a
    result — since that result can no longer be trusted to have been
    exclusive. Every mutation that can affect who counts as an
    administrator (`services/roleService.ts`'s `assignRole`/`removeRole`/
    `updateRole`/`deleteRole`/`setMembershipStatus`) runs inside this. */
export async function withOrganizationRoleLock<T>(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  fn: (handle: OrganizationLockHandle) => Promise<T>,
  options?: { leaseTtlMs?: number; renewIntervalMs?: number },
): Promise<T> {
  const leaseTtlMs = options?.leaseTtlMs ?? LEASE_TTL_MS;
  const renewIntervalMs = options?.renewIntervalMs ?? LEASE_RENEW_INTERVAL_MS;

  const handle = await acquireLock(organizationId, dataAdapterMode, leaseTtlMs);

  let leaseLost: Error | null = null;
  const renewalTimer = setInterval(() => {
    renewLease(handle, dataAdapterMode, leaseTtlMs).catch((error) => {
      leaseLost = error instanceof Error ? error : new LockLeaseLostError(String(error));
    });
  }, renewIntervalMs);
  // Node/test environments should never keep the process alive just for
  // this heartbeat.
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
