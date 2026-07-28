import type { DefaultRoleKey } from './defaultRoles';

/**
 * Phase 22 (Role-Based Access Control). Maps every pre-existing role
 * string this codebase already writes — `types/membership.ts`'s
 * `MembershipRole` (identity-mode) and `types/organization.ts`'s
 * `OrganizationRole` (mock/wix-mode) are the same five-value vocabulary —
 * onto one of the seven Phase 22 default role keys, so that:
 *
 *  1. No existing `Membership`/`OrganizationMembership` row needs to
 *     change for permission resolution to work.
 *  2. `PermissionService.resolvePermissions` can accept literally any role
 *     string this codebase has ever written and produce the exact
 *     permission set the corresponding default role grants.
 *  3. "No existing authorization behavior may change" holds by
 *     construction: `owner`/`administrator` both resolve to the
 *     `administrator` default role (full access, same as today's
 *     `hasAdminTierMembership` check), `caseManager` to `funeralDirector`,
 *     `staff` to `officeStaff`, and `readOnly` to `readOnly`.
 *
 * A role key that isn't in this table is assumed to already be a Phase 22
 * key (one of `DEFAULT_ROLE_KEYS` or a generated custom-role key) and is
 * passed through unchanged.
 */
export const LEGACY_ROLE_KEY_ALIASES: Record<string, DefaultRoleKey> = {
  owner: 'administrator',
  administrator: 'administrator',
  caseManager: 'funeralDirector',
  staff: 'officeStaff',
  readOnly: 'readOnly',
};

export function resolveRoleKeyAlias(roleKey: string): string {
  return LEGACY_ROLE_KEY_ALIASES[roleKey] ?? roleKey;
}
