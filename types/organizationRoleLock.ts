/**
 * Phase 22 (Role-Based Access Control) — security-correction rounds
 * (2026-07-27 through 2026-07-29). A durable, per-organization mutual-
 * exclusion **lease**, backing `services/organizationLockService.ts`'s
 * `withOrganizationRoleLock` — the mechanism that makes the "an
 * organization can never be left with zero active administrators"
 * invariant safe under concurrent requests, and makes concurrent seeding
 * duplicate-free. See that module's own comment for the full design
 * (lease/renewal/fencing/expiry/stale-recovery/failure behavior).
 *
 * `id` (the Wix system `_id`, and this row's own `id` field) is always set
 * to the `organizationId` itself — deterministic, so at most one lock row
 * can ever exist per organization, and acquiring the lock is exactly
 * "insert with this id; if it already exists, someone else holds it,"
 * relying only on ordinary unique-id insert semantics, not Wix Data
 * revision/optimistic-concurrency behavior this project has not
 * independently confirmed.
 *
 * `fenceToken` (added in the second security-correction round, 2026-07-29):
 * a monotonically increasing integer, incremented every time this
 * organization's lock is acquired (fresh or reclaimed from a stale
 * holder). Combined with `lockToken`, this is what makes renewal and
 * release *ownership-safe*: a caller must present a `lockToken` AND
 * `fenceToken` that both still match the stored row to renew or release
 * it — a caller whose lease has been reclaimed by a newer owner (even one
 * that reused the exact same random `lockToken` value, astronomically
 * unlikely but not assumed away) is distinguished by the fence number
 * having moved on.
 */
export type OrganizationRoleLock = {
  id: string;
  organizationId: string;
  lockToken: string;
  fenceToken: number;
  lockedAt: string;
  expiresAt: string;
};
