/**
 * Phase 22 (Role-Based Access Control) — security-correction round
 * (2026-07-27/28). Deterministic id derivation for every *seeded* RBAC
 * row (the permission catalog, the seven platform-default roles and
 * their permission grants, and one organization's default-role
 * enablement roster) — never for a genuinely new, user-initiated row
 * (a custom role, a custom role's own permission grants, an audit entry),
 * which still gets a fresh random id from the caller's `idFactory`.
 *
 * This is what makes concurrent seeding safe without a lock: two callers
 * seeding the "same" logical row (the same permission key, the same
 * default role, the same organization's enablement of that role) compute
 * the *identical* id, so a second insert attempt collides with the
 * first's (already-confirmed-reliable, per `services/organizationLockService.ts`'s
 * own comment) unique-id conflict instead of succeeding with a different
 * random id and creating a duplicate. `services/roleService.ts`'s live
 * seeding functions and `services/__mocks__/rbacFixtures.ts`'s static
 * mock seed both derive ids through these same functions, so mock and
 * live behavior can never silently diverge.
 */
import crypto from 'crypto';

export function permissionFixtureId(key: string): string {
  return `permission-${key}`;
}

export function defaultRoleFixtureId(key: string): string {
  return `role-${key}`;
}

export function defaultRolePermissionFixtureId(roleKey: string, permissionKey: string): string {
  return `rolepermission-${roleKey}-${permissionKey}`;
}

/**
 * Phase 38 (RBAC Grant Hygiene). Deterministic id for a *custom* role's
 * permission grant, derived from `roleId + permissionKey` — applied
 * **prospectively** to new custom-role grant writes (createCustomRole /
 * cloneRole / updateRole.addPermissions). Historically these used a fresh
 * random `idFactory()` id, giving no DB-level dedup and allowing (in
 * principle) two rows for the same (role, permission). A deterministic id
 * makes re-inserting the same grant a no-op upsert (the existing
 * insert-idempotent path treats the resulting 409 as success, never an
 * overwrite), which is the sanctioned substitute for a compound-unique
 * index Wix cannot provide. A custom role's `id` is a UUID and permission
 * keys are short, so the readable form is always well under Wix's hard
 * 128-char `_id` cap; the sha256 branch is a defensive fallback only (same
 * hashing pattern as the Phase 36/37 variant-aware ids). Two distinct
 * (roleId, permissionKey) pairs never collide; a collision can only occur
 * for the *same* grant, which is exactly the idempotent case.
 */
export function customRolePermissionId(roleId: string, permissionKey: string): string {
  const readable = `rolepermission-${roleId}-${permissionKey}`;
  if (readable.length <= 128) return readable;
  const digest = crypto.createHash('sha256').update(`rolepermission|${roleId}|${permissionKey}`).digest('hex').slice(0, 40);
  return `rolepermission-h-${digest}`;
}

export function organizationRoleFixtureId(organizationId: string, roleKey: string): string {
  return `orgrole-${organizationId}-${roleKey}`;
}

/**
 * Manors go-live hardening. Deterministic id for one organization's
 * permission override on one platform-default role — `(organizationId,
 * roleKey, permissionKey)` is the enforced-unique tuple (see
 * `types/organizationRolePermissionOverride.ts`'s own comment for why a
 * deterministic id is the substitute for a compound-unique index Wix
 * cannot provide). Same readable-form-with-sha256-fallback shape as
 * `customRolePermissionId`, for the same reason: organization ids are
 * real Wix item ids and not bounded short, so the 128-char `_id` cap is a
 * genuine (if unlikely) risk worth guarding against defensively.
 */
export function organizationRolePermissionOverrideId(organizationId: string, roleKey: string, permissionKey: string): string {
  const readable = `roleoverride-${organizationId}-${roleKey}-${permissionKey}`;
  if (readable.length <= 128) return readable;
  const digest = crypto.createHash('sha256').update(`roleoverride|${organizationId}|${roleKey}|${permissionKey}`).digest('hex').slice(0, 40);
  return `roleoverride-h-${digest}`;
}
