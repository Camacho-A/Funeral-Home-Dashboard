/**
 * Phase 22 (Role-Based Access Control). One row of the `organizationRoles`
 * Wix collection — the materialized roster of which `Role` rows (default
 * or custom) are currently available for assignment within one
 * organization. Every organization gets seven of these at creation time
 * (one per `domain/rbac/defaultRoles.ts` entry, each pointing at the
 * shared platform-default `Role` row); cloning a role
 * (`RoleService.cloneRole`) adds one more pointing at the new custom
 * `Role` row it just created.
 *
 * Named `OrganizationRoleEnablement` in TypeScript (not `OrganizationRole`)
 * to avoid colliding with `types/organization.ts`'s pre-existing
 * `OrganizationRole` — the closed string union naming the legacy
 * `Membership.role`/`OrganizationMembership.role` field, which this type
 * is unrelated to.
 */
export type OrganizationRoleEnablement = {
  id: string;
  organizationId: string;
  roleId: string;
  createdAt: string;
};
