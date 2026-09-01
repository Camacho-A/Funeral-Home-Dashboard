import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDefaultRoleReconciliation, listReconciliationRecords } from './rbacReconciliationService';
import { rolePermissionFixtures } from './__mocks__/rbacFixtures';
import { rbacReconciliationRecordFixtures } from './__mocks__/rbacReconciliationFixtures';
import { defaultRoleFixtureId, defaultRolePermissionFixtureId } from '../domain/rbac/deterministicIds';
import { resolvePermissionKeysForRole } from './permissionService';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
const idFactory = () => `rec-test-${(idCounter += 1)}`;

let snapshot: typeof rolePermissionFixtures;
beforeEach(() => {
  idCounter = 0;
  snapshot = rolePermissionFixtures.map((rp) => ({ ...rp }));
  rbacReconciliationRecordFixtures.length = 0;
});
afterEach(() => {
  rolePermissionFixtures.length = 0;
  rolePermissionFixtures.push(...snapshot);
  rbacReconciliationRecordFixtures.length = 0;
});

describe('runDefaultRoleReconciliation', () => {
  it('a converged system yields 0 changes and (dry-run) persists nothing', async () => {
    const record = await runDefaultRoleReconciliation({ mode: 'dry_run', idFactory }, 'mock');
    expect(record.summary.requiredChanges).toBe(0);
    expect(record.mode).toBe('dry_run');
    expect(record.scopeMarker).toBe('PLATFORM');
    expect(record.organizationId).toBeNull();
    expect(rbacReconciliationRecordFixtures).toHaveLength(0); // dry run never persists
  });

  it('dry-run is READ-ONLY: a missing grant is reported but NOT inserted', async () => {
    const accountingRoleId = defaultRoleFixtureId('accounting');
    const idx = rolePermissionFixtures.findIndex((rp) => rp.roleId === accountingRoleId && rp.permissionKey === 'accounting.manage');
    rolePermissionFixtures.splice(idx, 1);
    const before = rolePermissionFixtures.length;

    const record = await runDefaultRoleReconciliation({ mode: 'dry_run', idFactory }, 'mock');
    expect(record.summary.grantsAdded).toBe(1);
    expect(rolePermissionFixtures.length).toBe(before); // no mutation
    expect(rbacReconciliationRecordFixtures).toHaveLength(0);
  });

  it('apply inserts the missing grant, records it PLATFORM-scoped, and authorization then resolves it', async () => {
    const accountingRoleId = defaultRoleFixtureId('accounting');
    const idx = rolePermissionFixtures.findIndex((rp) => rp.roleId === accountingRoleId && rp.permissionKey === 'accounting.manage');
    rolePermissionFixtures.splice(idx, 1);

    // Before: authorization does NOT resolve accounting.manage for the accounting role.
    const before = await resolvePermissionKeysForRole('accounting', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(before.has('accounting.manage')).toBe(false);

    const record = await runDefaultRoleReconciliation({ mode: 'apply', actor: 'admin-123', idFactory }, 'mock');
    expect(record.mode).toBe('apply');
    expect(record.summary.grantsAdded).toBe(1);
    expect(record.actor).toBe('admin-123');
    expect(rbacReconciliationRecordFixtures).toHaveLength(1);
    expect(rbacReconciliationRecordFixtures[0].scopeMarker).toBe('PLATFORM');

    // After: authorization resolves it (grant inserted with deterministic id).
    const after = await resolvePermissionKeysForRole('accounting', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(after.has('accounting.manage')).toBe(true);
    expect(rolePermissionFixtures.some((rp) => rp.id === defaultRolePermissionFixtureId('accounting', 'accounting.manage'))).toBe(true);
  });

  it('is idempotent: a second dry-run after apply converges to 0 changes', async () => {
    const managerRoleId = defaultRoleFixtureId('manager');
    const idx = rolePermissionFixtures.findIndex((rp) => rp.roleId === managerRoleId && rp.permissionKey === 'report.export');
    rolePermissionFixtures.splice(idx, 1);

    const apply = await runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'mock');
    expect(apply.summary.requiredChanges).toBe(1);

    const secondDryRun = await runDefaultRoleReconciliation({ mode: 'dry_run', idFactory }, 'mock');
    expect(secondDryRun.summary.requiredChanges).toBe(0);

    const secondApply = await runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'mock');
    expect(secondApply.summary.requiredChanges).toBe(0);
  });

  it('apply backfills a missing createdAt without adding a row', async () => {
    const adminRoleId = defaultRoleFixtureId('administrator');
    const row = rolePermissionFixtures.find((rp) => rp.roleId === adminRoleId && rp.permissionKey === 'merchandise.manage')!;
    // Simulate the historical defect: strip createdAt.
    (row as { createdAt: unknown }).createdAt = undefined;
    const before = rolePermissionFixtures.length;

    const record = await runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'mock');
    expect(record.summary.createdAtBackfilled).toBe(1);
    expect(record.summary.grantsAdded).toBe(0);
    expect(rolePermissionFixtures.length).toBe(before); // repaired in place, no new row
    expect(rolePermissionFixtures.find((rp) => rp.id === row.id)!.createdAt).toBeTruthy();
  });

  it('never proposes destructive changes', async () => {
    const record = await runDefaultRoleReconciliation({ mode: 'dry_run', idFactory }, 'mock');
    expect(record.summary.destructiveChanges).toBe(0);
  });

  it('listReconciliationRecords returns persisted apply records', async () => {
    await runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'mock');
    const records = await listReconciliationRecords('mock');
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});
