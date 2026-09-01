import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRbacHealth, diagnoseRoleAuthorization, diagnoseMemberAuthorization } from './rbacIntegrityService';
import { rolePermissionFixtures } from './__mocks__/rbacFixtures';
import { membershipFixtures } from './__mocks__/identityFixtures';
import { defaultRoleFixtureId } from '../domain/rbac/deterministicIds';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let snapshot: typeof rolePermissionFixtures;
let memSnapshot: number;
beforeEach(() => {
  snapshot = rolePermissionFixtures.map((rp) => ({ ...rp }));
  memSnapshot = membershipFixtures.length;
});
afterEach(() => {
  rolePermissionFixtures.length = 0;
  rolePermissionFixtures.push(...snapshot);
  membershipFixtures.length = memSnapshot;
});

describe('checkRbacHealth', () => {
  it('reports HEALTHY on a converged system', async () => {
    const report = await checkRbacHealth('mock');
    expect(report.status).toBe('HEALTHY');
    expect(report.conditions).toEqual([]);
    expect(report.counts.missingDefaultGrants).toBe(0);
  });

  it('reports MISSING_DEFAULT_GRANTS when an expected grant is absent', async () => {
    const idx = rolePermissionFixtures.findIndex((rp) => rp.roleId === defaultRoleFixtureId('accounting') && rp.permissionKey === 'accounting.manage');
    rolePermissionFixtures.splice(idx, 1);
    const report = await checkRbacHealth('mock');
    expect(report.conditions).toContain('MISSING_DEFAULT_GRANTS');
    expect(report.counts.missingDefaultGrants).toBeGreaterThanOrEqual(1);
  });

  it('surfaces MALFORMED_DATA (stale key) at the top of severity ordering', async () => {
    rolePermissionFixtures.push({ id: 'stale', roleId: defaultRoleFixtureId('administrator'), permissionKey: 'legacy.gone' as never, createdAt: '2026-01-01T00:00:00.000Z' });
    const report = await checkRbacHealth('mock');
    expect(report.status).toBe('MALFORMED_DATA');
  });
});

describe('diagnoseRoleAuthorization', () => {
  it('for a converged default role, effective == expected and nothing missing', async () => {
    const diag = await diagnoseRoleAuthorization('administrator', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(diag.isDefaultRole).toBe(true);
    expect(diag.roleResolved).toBe(true);
    expect(diag.missingPermissions).toEqual([]);
    expect(diag.effectiveCount).toBe(diag.expectedCount);
  });

  it('pinpoints the missing permission when a grant is absent', async () => {
    const idx = rolePermissionFixtures.findIndex((rp) => rp.roleId === defaultRoleFixtureId('administrator') && rp.permissionKey === 'accounting.manage');
    rolePermissionFixtures.splice(idx, 1);
    const diag = await diagnoseRoleAuthorization('administrator', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(diag.missingPermissions).toContain('accounting.manage');
  });

  it('resolves legacy role aliases (administrator/owner → administrator)', async () => {
    const diag = await diagnoseRoleAuthorization('owner', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(diag.resolvedRoleKey).toBe('administrator');
    expect(diag.isDefaultRole).toBe(true);
  });
});

describe('diagnoseMemberAuthorization', () => {
  it('traces a member → role → effective permissions', async () => {
    const admin = membershipFixtures.find((m) => m.organizationId === DEFAULT_ORGANIZATION_ID && m.status === 'active');
    expect(admin).toBeDefined();
    const diag = await diagnoseMemberAuthorization(admin!.identityId, DEFAULT_ORGANIZATION_ID, 'mock');
    expect(diag.membershipFound).toBe(true);
    expect(diag.role).not.toBeNull();
  });

  it('reports membershipFound=false for an unknown identity', async () => {
    const diag = await diagnoseMemberAuthorization('no-such-identity', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(diag.membershipFound).toBe(false);
    expect(diag.role).toBeNull();
  });
});
