import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RolePermission } from '@/types/rolePermission';

/**
 * Fax permissions — live rollout (2026-11), in mock mode with the role
 * grants arranged the way live Manors has them: the shared default-role
 * rows were written at setup and do NOT carry fax.send / fax.confirm.
 */
let mockSession: { user: { id: string; email: string; displayName: string; source: 'mock' } } | null = null;
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { planFaxPermissionGrants, applyFaxPermissionGrants, FAX_PERMISSION_GRANTS } = await import('./faxPermissionMigration');
const { resolvePermissionKeysForRole } = await import('./permissionService');
const { rolePermissionFixtures, organizationRolePermissionOverrideFixtures } = await import('./__mocks__/rbacFixtures');
const { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
const { mockDefaultUser, mockManagerUser } = await import('./__mocks__/authFixtures');
const route = await import('@/app/api/organization/rbac/fax-permissions/route');

const ORG = DEFAULT_ORGANIZATION_ID;
let savedGrants: RolePermission[] = [];
let overridesLength = 0;
beforeEach(() => {
  savedGrants = [...rolePermissionFixtures];
  overridesLength = organizationRolePermissionOverrideFixtures.length;
  // Live-like: the shared rows predate the fax keys.
  rolePermissionFixtures.splice(0, rolePermissionFixtures.length, ...savedGrants.filter((g) => g.permissionKey !== 'fax.send' && g.permissionKey !== 'fax.confirm'));
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser as never };
});
afterEach(() => {
  rolePermissionFixtures.splice(0, rolePermissionFixtures.length, ...savedGrants);
  organizationRolePermissionOverrideFixtures.length = overridesLength;
  delete process.env.DATA_ADAPTER;
});

const holders = async (key: 'fax.send' | 'fax.confirm') => {
  const roles = ['administrator', 'manager', 'funeralDirector', 'officeStaff', 'arranger', 'accounting', 'readOnly', 'dispatch'];
  const out: string[] = [];
  for (const role of roles) if ((await resolvePermissionKeysForRole(role, ORG, 'mock')).has(key)) out.push(role);
  return out.sort();
};

describe('fax permission rollout', () => {
  it('before: nobody at the organization can fax — the plan lists exactly the 9 approved grants', async () => {
    expect(await holders('fax.send')).toEqual([]);
    const plan = await planFaxPermissionGrants(ORG, 'mock');
    expect(plan.applicable).toBe(true);
    expect(plan.grants.filter((g) => g.status === 'to_grant').map((g) => `${g.roleKey}:${g.permissionKey}`).sort()).toEqual(FAX_PERMISSION_GRANTS.map((g) => `${g.roleKey}:${g.permissionKey}`).sort());
    expect(plan.grants).toHaveLength(9);
  });

  it('after: exactly the approved matrix, as organization-level grants only — the shared role rows are untouched; running again changes nothing', async () => {
    const sharedBefore = rolePermissionFixtures.length;
    await applyFaxPermissionGrants(ORG, mockDefaultUser.id, 'mock');
    expect(await holders('fax.send')).toEqual(['administrator', 'arranger', 'funeralDirector', 'manager', 'officeStaff']);
    expect(await holders('fax.confirm')).toEqual(['administrator', 'funeralDirector', 'manager', 'officeStaff']);
    expect(rolePermissionFixtures).toHaveLength(sharedBefore);
    const written = organizationRolePermissionOverrideFixtures.slice(overridesLength);
    expect(written).toHaveLength(9);
    expect(written.every((o) => o.organizationId === ORG && o.action === 'grant')).toBe(true);
    // Another organization is unaffected.
    expect((await resolvePermissionKeysForRole('manager', SECOND_MOCK_ORGANIZATION_ID, 'mock')).has('fax.send')).toBe(false);
    const again = await applyFaxPermissionGrants(ORG, mockDefaultUser.id, 'mock');
    expect(again.grants.every((g) => g.status === 'already_granted')).toBe(true);
    expect(organizationRolePermissionOverrideFixtures.slice(overridesLength)).toHaveLength(9);
  });

  it('never overrides the organization\'s own decision: a revoked pair stays revoked and is reported', async () => {
    organizationRolePermissionOverrideFixtures.push({
      id: 'roleoverride-managed-cremations-officeStaff-fax.confirm', organizationId: ORG, roleKey: 'officeStaff', permissionKey: 'fax.confirm', action: 'revoke',
      reason: 'fictional test decision', createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'admin', updatedAt: '2026-11-01T00:00:00.000Z',
    });
    const plan = await applyFaxPermissionGrants(ORG, mockDefaultUser.id, 'mock');
    expect(plan.grants.find((g) => g.roleKey === 'officeStaff' && g.permissionKey === 'fax.confirm')!.status).toBe('revoked_by_organization');
    expect(await holders('fax.confirm')).toEqual(['administrator', 'funeralDirector', 'manager']);
  });

  it('does not apply to an organization without fax bundles', async () => {
    expect(await planFaxPermissionGrants(SECOND_MOCK_ORGANIZATION_ID, 'mock')).toEqual({ organizationId: SECOND_MOCK_ORGANIZATION_ID, applicable: false, grants: [] });
    await expect(applyFaxPermissionGrants(SECOND_MOCK_ORGANIZATION_ID, 'admin', 'mock')).rejects.toThrow(/only apply/);
  });

  it('route: Administrators only (user.manageRoles); the organization comes from the session', async () => {
    const post = (org: string) => route.POST(new Request('http://localhost/api/organization/rbac/fax-permissions', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: org }) }));
    mockSession = { user: mockManagerUser as never };
    expect((await post(ORG)).status).toBe(403);
    expect(organizationRolePermissionOverrideFixtures.slice(overridesLength)).toHaveLength(0);
    mockSession = { user: mockDefaultUser as never };
    expect((await post(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
    const plan = await route.GET(new Request(`http://localhost/api/organization/rbac/fax-permissions?organizationId=${ORG}`));
    expect(((await plan.json()) as { grants: unknown[] }).grants).toHaveLength(9);
    expect(organizationRolePermissionOverrideFixtures.slice(overridesLength)).toHaveLength(0);
    expect((await post(ORG)).status).toBe(200);
    expect(organizationRolePermissionOverrideFixtures.slice(overridesLength)).toHaveLength(9);
  });
});
