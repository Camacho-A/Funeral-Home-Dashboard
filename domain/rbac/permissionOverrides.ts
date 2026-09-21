import type { PermissionKey } from './permissionCatalog';
import type { OrganizationRolePermissionOverrideAction } from '../../types/organizationRolePermissionOverride';

/**
 * Manors go-live hardening (2026-09). PURE resolution logic — no I/O,
 * mirroring `domain/rbac/reconciliationPlan.ts`'s own separation of
 * computation from persistence. Given a role's base (code-catalog)
 * permission set and one organization's override rows for that role,
 * computes the effective set:
 *
 *   effective = (base ∪ grants) − revokes
 *
 * Revokes are applied last, so a revoke always wins over a grant for the
 * same permission — the required behavior even if malformed historical
 * data somehow persisted both a grant and a revoke override for the same
 * `(organizationId, roleKey, permissionKey)` tuple (which the deterministic
 * id in `domain/rbac/deterministicIds.ts#organizationRolePermissionOverrideId`
 * prevents in the first place, but resolution stays safe even if that
 * invariant were ever violated by a data-repair mistake).
 */
export type OverrideLike = {
  permissionKey: PermissionKey;
  action: OrganizationRolePermissionOverrideAction;
};

export function applyPermissionOverrides(base: Iterable<PermissionKey>, overrides: readonly OverrideLike[]): Set<PermissionKey> {
  const effective = new Set<PermissionKey>(base);
  for (const override of overrides) {
    if (override.action === 'grant') effective.add(override.permissionKey);
  }
  for (const override of overrides) {
    if (override.action === 'revoke') effective.delete(override.permissionKey);
  }
  return effective;
}

/** The subset of `overrides` whose `action` is `'grant'`, as a plain
    permission-key array — used by the integrity diagnosis to report
    "which grants explain this organization's extra permissions". */
export function grantedPermissionKeys(overrides: readonly OverrideLike[]): PermissionKey[] {
  return overrides.filter((o) => o.action === 'grant').map((o) => o.permissionKey);
}

/** The subset of `overrides` whose `action` is `'revoke'` — used by the
    integrity diagnosis to report "which revokes explain this
    organization's missing permissions". */
export function revokedPermissionKeys(overrides: readonly OverrideLike[]): PermissionKey[] {
  return overrides.filter((o) => o.action === 'revoke').map((o) => o.permissionKey);
}
