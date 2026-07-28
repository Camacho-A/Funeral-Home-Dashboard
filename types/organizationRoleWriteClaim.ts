/**
 * Phase 22 (Role-Based Access Control) — third security-correction round
 * (2026-07-29/30). The atomic gate a protected write must hold before it
 * may touch `organizationMemberships`/`roles`/`rolePermissions`/
 * `organizationRoles` — see `services/organizationLockService.ts`'s own
 * comment for the full design and, critically, for why this exists at
 * all: `assertFenceStillCurrent` followed by a *separate* write call is
 * not sufficient (a lease can be reclaimed in the gap between the check
 * and the write), and Wix Data has no revision/optimistic-concurrency
 * support to make the write itself conditional (confirmed empirically —
 * `insertDataItem`/`updateDataItem` responses carry no `revision` field,
 * and a stale "revision" value in a request body is silently ignored).
 *
 * A write claim is held only for the few milliseconds between "I am about
 * to write" and "I finished writing" — unlike the lease itself (which can
 * legitimately be held for as long as an operation's *reads* take), a
 * live claim structurally **blocks lease reclaim** (see
 * `organizationLockService.ts`'s `tryAcquireOnce`), so a reclaim can never
 * happen while a write is provably in flight. `id` is the `organizationId`
 * itself — deterministic, exactly like `OrganizationRoleLock` — so
 * claiming is "insert a row with this id; conflict means someone else
 * already holds it," the one atomic primitive this project has
 * confirmed Wix Data actually provides.
 */
export type OrganizationRoleWriteClaim = {
  id: string;
  organizationId: string;
  lockToken: string;
  fenceToken: number;
  claimedAt: string;
  expiresAt: string;
};
