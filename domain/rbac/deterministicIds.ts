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
export function permissionFixtureId(key: string): string {
  return `permission-${key}`;
}

export function defaultRoleFixtureId(key: string): string {
  return `role-${key}`;
}

export function defaultRolePermissionFixtureId(roleKey: string, permissionKey: string): string {
  return `rolepermission-${roleKey}-${permissionKey}`;
}

export function organizationRoleFixtureId(organizationId: string, roleKey: string): string {
  return `orgrole-${organizationId}-${roleKey}`;
}
