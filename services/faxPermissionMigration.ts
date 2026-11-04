import type { DataAdapterMode } from '@/lib/env';
import type { PermissionKey } from '@/domain/rbac/permissionCatalog';
import { organizationRolePermissionOverrideId } from '@/domain/rbac/deterministicIds';
import { deathCertificateFaxSettings } from '@/domain/faxBundles/faxSettings';
import { isOrganizationAllowedInDeployment } from '@/lib/auth/deploymentOrganizations';
import { resolvePermissionKeysForRole, resolveRoleForKey } from './permissionService';
import { getOverridesForRole, upsertOverride } from './organizationRoleOverrideService';

/**
 * Fax permissions — live rollout (2026-11). `fax.send` / `fax.confirm` are in
 * the code role definitions, but an active organization's role grants live in
 * Wix and were written when it was set up; they never pick up new keys by
 * themselves. This grants the approved matrix to ONE organization through the
 * existing organization-level override layer (the same rows Settings > Roles
 * writes, with its lock and audit trail) — never by writing the SHARED
 * default-role rows other organizations (Gus) also read.
 *
 * Fixed server-side: the pairs below and the organization (one that has fax
 * bundles, served by this deployment). Never overrides an organization's own
 * decision: a pair the organization has explicitly revoked is left as it is
 * and reported. Idempotent: running it again changes nothing.
 */
export const FAX_PERMISSION_GRANTS: ReadonlyArray<{ roleKey: string; permissionKey: PermissionKey }> = [
  ...['administrator', 'manager', 'funeralDirector', 'officeStaff', 'arranger'].map((roleKey) => ({ roleKey, permissionKey: 'fax.send' as const })),
  ...['administrator', 'manager', 'funeralDirector', 'officeStaff'].map((roleKey) => ({ roleKey, permissionKey: 'fax.confirm' as const })),
];

export const FAX_PERMISSION_GRANT_REASON = 'Fax bundles (2026-11): approved fax permission matrix.';

export type FaxPermissionGrantStatus = 'already_granted' | 'to_grant' | 'revoked_by_organization' | 'role_not_found';
export type FaxPermissionPlan = {
  organizationId: string;
  applicable: boolean;
  grants: Array<{ roleKey: string; permissionKey: PermissionKey; overrideId: string; status: FaxPermissionGrantStatus }>;
};

export class FaxPermissionMigrationError extends Error {}

function applicable(organizationId: string): boolean {
  return deathCertificateFaxSettings(organizationId) !== null && isOrganizationAllowedInDeployment(organizationId);
}

/** Read-only: what applying would do. */
export async function planFaxPermissionGrants(organizationId: string, mode: DataAdapterMode): Promise<FaxPermissionPlan> {
  if (!applicable(organizationId)) return { organizationId, applicable: false, grants: [] };
  const grants: FaxPermissionPlan['grants'] = [];
  for (const { roleKey, permissionKey } of FAX_PERMISSION_GRANTS) {
    const overrideId = organizationRolePermissionOverrideId(organizationId, roleKey, permissionKey);
    const role = await resolveRoleForKey(roleKey, organizationId, mode);
    if (!role) {
      grants.push({ roleKey, permissionKey, overrideId, status: 'role_not_found' });
      continue;
    }
    const own = (await getOverridesForRole(organizationId, roleKey, mode)).find((o) => o.permissionKey === permissionKey);
    if (own?.action === 'revoke') {
      grants.push({ roleKey, permissionKey, overrideId, status: 'revoked_by_organization' });
      continue;
    }
    const effective = await resolvePermissionKeysForRole(roleKey, organizationId, mode);
    grants.push({ roleKey, permissionKey, overrideId, status: effective.has(permissionKey) ? 'already_granted' : 'to_grant' });
  }
  return { organizationId, applicable: true, grants };
}

/** Grants every `to_grant` pair (organization-level grant overrides only). */
export async function applyFaxPermissionGrants(organizationId: string, actorIdentityId: string, mode: DataAdapterMode): Promise<FaxPermissionPlan> {
  if (!applicable(organizationId)) throw new FaxPermissionMigrationError('Fax permissions only apply to an organization with fax bundles, in a deployment that serves it.');
  const plan = await planFaxPermissionGrants(organizationId, mode);
  for (const grant of plan.grants.filter((g) => g.status === 'to_grant')) {
    await upsertOverride(
      { organizationId, roleKey: grant.roleKey, permissionKey: grant.permissionKey, action: 'grant', reason: FAX_PERMISSION_GRANT_REASON, actorIdentityId, idFactory: () => grant.overrideId },
      mode,
    );
  }
  return planFaxPermissionGrants(organizationId, mode);
}
