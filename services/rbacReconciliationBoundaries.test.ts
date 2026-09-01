import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDefaultRoleReconciliation } from './rbacReconciliationService';
import { createCustomRole } from './roleService';
import { resolvePermissionKeysForRole } from './permissionService';
import { rolePermissionFixtures, roleFixtures, organizationRoleFixtures, organizationRoleAuditEntryFixtures } from './__mocks__/rbacFixtures';
import { rbacReconciliationRecordFixtures } from './__mocks__/rbacReconciliationFixtures';
import { defaultRoleFixtureId } from '../domain/rbac/deterministicIds';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
const idFactory = () => `boundary-test-${(idCounter += 1)}`;

let snap: {
  rp: typeof rolePermissionFixtures;
  role: number;
  orgRole: number;
  audit: number;
};
beforeEach(() => {
  idCounter = 0;
  snap = {
    rp: rolePermissionFixtures.map((rp) => ({ ...rp })),
    role: roleFixtures.length,
    orgRole: organizationRoleFixtures.length,
    audit: organizationRoleAuditEntryFixtures.length,
  };
  rbacReconciliationRecordFixtures.length = 0;
});
afterEach(() => {
  rolePermissionFixtures.length = 0;
  rolePermissionFixtures.push(...snap.rp);
  roleFixtures.length = snap.role;
  organizationRoleFixtures.length = snap.orgRole;
  organizationRoleAuditEntryFixtures.length = snap.audit;
  rbacReconciliationRecordFixtures.length = 0;
});

describe('Phase 38 reconciliation — security boundaries', () => {
  it('NEVER modifies an organization-owned custom role while reconciling global defaults', async () => {
    const custom = await createCustomRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Records Clerk', description: 'custom', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    const customGrantsBefore = rolePermissionFixtures.filter((rp) => rp.roleId === custom.id).map((rp) => rp.permissionKey).sort();

    // Drift a default role so reconciliation has real work to do.
    const idx = rolePermissionFixtures.findIndex((rp) => rp.roleId === defaultRoleFixtureId('accounting') && rp.permissionKey === 'accounting.manage');
    rolePermissionFixtures.splice(idx, 1);

    const record = await runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'mock');

    // The custom role's grants are byte-for-byte unchanged.
    const customGrantsAfter = rolePermissionFixtures.filter((rp) => rp.roleId === custom.id).map((rp) => rp.permissionKey).sort();
    expect(customGrantsAfter).toEqual(customGrantsBefore);

    // No change in the run references the custom role, and every change is GLOBAL_DEFAULT_ROLE scoped.
    expect(record.changes.every((c) => c.roleScope === 'GLOBAL_DEFAULT_ROLE')).toBe(true);
    expect(record.changes.some((c) => c.roleId === custom.id)).toBe(false);
  });

  it('records a GLOBAL run with a PLATFORM marker and null organizationId (no per-org fan-out)', async () => {
    const record = await runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'mock');
    expect(record.scopeMarker).toBe('PLATFORM');
    expect(record.organizationId).toBeNull();
    // Exactly one record for one global run — never one per tenant.
    expect(rbacReconciliationRecordFixtures).toHaveLength(1);
  });

  it('is strictly ADDITIVE — no grant present before a run is ever removed', async () => {
    const before = new Set(rolePermissionFixtures.map((rp) => rp.id));
    await runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'mock');
    for (const id of before) {
      expect(rolePermissionFixtures.some((rp) => rp.id === id)).toBe(true);
    }
    // And it never reports a destructive change.
    const record = await runDefaultRoleReconciliation({ mode: 'dry_run', idFactory }, 'mock');
    expect(record.summary.destructiveChanges).toBe(0);
  });

  it('a reconciled default role does not leak grants across tenants (default roles are global by design; custom roles stay org-scoped)', async () => {
    // A custom role in org A must not gain default-role grants, and resolving
    // a default role for any org yields the same global grant set.
    const custom = await createCustomRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Scoped', description: '', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    await runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'mock');
    const customPerms = await resolvePermissionKeysForRole(custom.key, DEFAULT_ORGANIZATION_ID, 'mock');
    expect([...customPerms].sort()).toEqual(['case.read']);
  });
});
