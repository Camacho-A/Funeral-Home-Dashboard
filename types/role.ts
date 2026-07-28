/**
 * Phase 22 (Role-Based Access Control). One row of the `roles` Wix
 * collection — a named, ordered set of permissions.
 *
 * `organizationId: null` marks one of the seven immutable platform-default
 * roles (`domain/rbac/defaultRoles.ts`), shared read-only across every
 * organization. `organizationId: <id>` marks a role that specific
 * organization created — either a brand-new custom role or a clone of a
 * default role it has renamed/reconfigured — which only that organization
 * may update or delete (see `services/roleService.ts`).
 *
 * Deliberately a separate type from `types/organization.ts`'s
 * `OrganizationRole` (a closed five-value string union naming the
 * pre-existing `Membership.role`/`OrganizationMembership.role` field) —
 * that type continues to exist and continues to mean exactly what it
 * always has. This `Role` type is the Phase 22 catalog entity a role
 * *key* (including every legacy value, via
 * `domain/rbac/legacyRoleAliases.ts`) resolves to.
 */
export type Role = {
  id: string;
  key: string;
  name: string;
  description: string;
  organizationId: string | null;
  isSystemDefault: boolean;
  createdAt: string;
  updatedAt: string;
};
