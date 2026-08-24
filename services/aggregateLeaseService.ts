import type { DataAdapterMode } from '../lib/env';
import {
  withInventoryLock,
  commitProtectedWrite,
  InventoryLockError,
  InventoryLockLeaseLostError,
  type InventoryLockHandle,
} from './inventoryLockService';

/**
 * Phase 36 (Procurement & Accounts Payable). A neutrally-named surface over
 * the durable lease + write-claim primitive first built in Phase 22
 * (`organizationLockService`) and generalized in Phase 35
 * (`inventoryLockService`). Rather than mint a THIRD lock collection, Phase 36
 * REUSES the existing generic keyed-lease substrate (`inventoryLocks` /
 * `inventoryWriteClaims`, each keyed `_id = lockKey`) with namespaced
 * aggregate keys — those two collections are, mechanically, an
 * organization's general-purpose per-key mutex store; the `_id` is an
 * arbitrary lock key. `inventoryLockService` remains their sole writer
 * (callers here go THROUGH its functions, never touch the collections), so
 * the Phase 35 sole-writer boundary is preserved. ADR-040 documents this
 * widened purpose. See the residual-race disclosure in
 * `services/inventoryLockService.ts` — Wix Data still has no OCC/CAS, so a
 * single final-fence-to-write gap remains; we never claim perfect
 * serializability.
 *
 * Procurement/AP posting-sensitive transitions (PO receiving/finalization,
 * bill posting, match finalization, vendor payment, void/reversal) run under
 * a NARROW per-aggregate lease — never an organization-wide AP lock — keyed
 * by the specific PO or bill they mutate. Aggregate keys are prefixed
 * (`po-…`, `bill-…`) so they can never collide with an inventory stock-line
 * key (`{org}-{location}-{product}`).
 */
export type AggregateLeaseHandle = InventoryLockHandle;
export { InventoryLockError as AggregateLeaseError, InventoryLockLeaseLostError as AggregateLeaseLostError };

/** Lease key for one purchase order — serializes receiving, finalization,
    and cancellation of a single PO without blocking any other PO. */
export function purchaseOrderLeaseKey(organizationId: string, purchaseOrderId: string): string {
  return `po-${organizationId}-${purchaseOrderId}`;
}

/** Lease key for one vendor bill — serializes bill posting, void, and
    payment recording against a single bill (payments serialize per bill so
    two partial payments can't over-pay it), without blocking any other bill. */
export function vendorBillLeaseKey(organizationId: string, vendorBillId: string): string {
  return `bill-${organizationId}-${vendorBillId}`;
}

/** Run `fn` while holding the exclusive per-aggregate lease. */
export function withAggregateLease<T>(
  lockKey: string,
  dataAdapterMode: DataAdapterMode,
  fn: (handle: AggregateLeaseHandle) => Promise<T>,
): Promise<T> {
  return withInventoryLock(lockKey, dataAdapterMode, fn);
}

/** Dispatch a write behind a fresh write-claim + final fence check. Call
    inside a `withAggregateLease` block, mirroring inventory's
    lease→claim→write discipline for every posting-sensitive mutation. */
export function commitLeasedWrite<T>(
  handle: AggregateLeaseHandle,
  dataAdapterMode: DataAdapterMode,
  performWrite: () => Promise<T>,
): Promise<T> {
  return commitProtectedWrite(handle, dataAdapterMode, performWrite);
}
