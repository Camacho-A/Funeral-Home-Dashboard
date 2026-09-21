import type { PermissionKey } from '../domain/rbac/permissionCatalog';

/**
 * Manors go-live hardening (2026-09) — organization-scoped RBAC overrides.
 * One row of the `organizationRolePermissionOverrides` Wix collection: an
 * explicit, auditable statement that one organization's effective
 * permission set for one platform-default role deviates from the shared
 * base catalog (`domain/rbac/defaultRoles.ts`) by exactly one permission.
 *
 * This exists because platform-default roles are genuinely global —
 * `types/role.ts`'s `organizationId: null` rows, shared `rolePermissions`
 * grants keyed only by `(roleId, permissionKey)` with no organization
 * dimension at all (confirmed by tracing `services/roleService.ts`'s own
 * seeding functions, not assumed). There was previously no way for one
 * organization to differ from the shared default without either mutating
 * the shared rows (affecting every tenant) or cloning the role into a new,
 * independent row (forking it from all future catalog corrections — see
 * this same file's own architecture-decision history for why that was
 * rejected). This collection is the additive third option: the base role
 * is never touched, never forked; one organization's *documented* deltas
 * are layered on top of it, purely at resolution time
 * (`services/permissionService.ts#resolvePermissionKeysForRole`).
 *
 * Deliberately restricted to platform-default role keys only in this first
 * implementation (validated at the service layer, not this type) — a
 * custom, organization-owned role already has no external "base" to
 * override in the first place (its own live grants are authoritative), so
 * there is no override use case for it yet.
 *
 * At most one row may exist for a given `(organizationId, roleKey,
 * permissionKey)` tuple — enforced by a deterministic id
 * (`domain/rbac/deterministicIds.ts#organizationRolePermissionOverrideId`),
 * the same substitute for compound uniqueness this codebase already uses
 * everywhere Wix Data's lack of a compound-unique index would otherwise be
 * a gap. A grant and a revoke for the same tuple can therefore never
 * coexist by construction — "update" (flipping grant↔revoke, or changing
 * `reason`) is a full-row replace of that one deterministic id, never a
 * second insert.
 */
export type OrganizationRolePermissionOverrideAction = 'grant' | 'revoke';

export type OrganizationRolePermissionOverride = {
  id: string;
  organizationId: string;
  /** A `domain/rbac/defaultRoles.ts` `DefaultRoleKey` — never a custom
      role's generated key in this first implementation (see this type's
      own doc comment for why). Stored as a plain string, matching
      `Membership.role`'s own convention, so alias resolution
      (`domain/rbac/legacyRoleAliases.ts`) applies identically. */
  roleKey: string;
  permissionKey: PermissionKey;
  action: OrganizationRolePermissionOverrideAction;
  /** Human-readable justification — why this organization's effective
      permissions deviate from the shared base. Not read by any
      authorization decision; recorded for the same reason
      `RolePermission`'s `createdAt` is metadata, not a security field. */
  reason: string | null;
  createdAt: string;
  /** The authenticated identity that created this override — never
      trusted from a client body, always the server-resolved caller. */
  createdBy: string;
  /** Set when an existing override's `action`/`reason` is later changed
      in place. `updatedBy` is deliberately not tracked on the row itself
      — mirrors `types/role.ts`'s own `createdAt`/`updatedAt`-only
      convention (no row in this codebase embeds an "updatedBy" field);
      "who changed this and when" is the audit trail's job
      (`organizationRoleAuditEntries`), not a duplicate field here. */
  updatedAt: string;
};
