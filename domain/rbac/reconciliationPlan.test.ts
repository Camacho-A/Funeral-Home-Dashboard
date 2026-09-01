import { describe, it, expect } from 'vitest';
import { computeDefaultRoleReconciliationPlan, type RawGrantRow } from './reconciliationPlan';
import { DEFAULT_ROLE_DEFINITIONS } from './defaultRoles';
import { defaultRoleFixtureId, defaultRolePermissionFixtureId } from './deterministicIds';

const NOW = '2026-09-01T00:00:00.000Z';

/** Build the fully-converged live grant set from the source definitions. */
function convergedRows(): RawGrantRow[] {
  const rows: RawGrantRow[] = [];
  for (const def of DEFAULT_ROLE_DEFINITIONS) {
    for (const key of def.permissions) {
      rows.push({
        id: defaultRolePermissionFixtureId(def.key, key),
        roleId: defaultRoleFixtureId(def.key),
        permissionKey: key,
        createdAt: NOW,
      });
    }
  }
  return rows;
}

describe('computeDefaultRoleReconciliationPlan', () => {
  it('a fully-converged live set yields ZERO changes (idempotency baseline)', () => {
    const plan = computeDefaultRoleReconciliationPlan(convergedRows());
    expect(plan.summary.requiredChanges).toBe(0);
    expect(plan.changes).toEqual([]);
    expect(plan.summary.destructiveChanges).toBe(0);
    expect(plan.summary.rolesScanned).toBe(7);
  });

  it('a missing expected grant produces exactly one additive grant_added with the deterministic id', () => {
    const rows = convergedRows().filter(
      (r) => !(r.roleId === defaultRoleFixtureId('accounting') && r.permissionKey === 'accounting.manage'),
    );
    const plan = computeDefaultRoleReconciliationPlan(rows);
    expect(plan.summary.grantsAdded).toBe(1);
    expect(plan.summary.createdAtBackfilled).toBe(0);
    expect(plan.summary.requiredChanges).toBe(1);
    const change = plan.changes[0];
    expect(change.kind).toBe('grant_added');
    expect(change.roleScope).toBe('GLOBAL_DEFAULT_ROLE');
    expect(change.permissionKey).toBe('accounting.manage');
    expect(change.grantId).toBe(defaultRolePermissionFixtureId('accounting', 'accounting.manage'));
    expect(change.rollback).toEqual({ op: 'delete_grant', grantId: change.grantId });
  });

  it('a present grant missing createdAt produces a created_at_backfilled change (not a new row)', () => {
    const rows = convergedRows().map((r) =>
      r.roleId === defaultRoleFixtureId('administrator') && r.permissionKey === 'merchandise.manage'
        ? { ...r, createdAt: undefined }
        : r,
    );
    const plan = computeDefaultRoleReconciliationPlan(rows);
    expect(plan.summary.grantsAdded).toBe(0);
    expect(plan.summary.createdAtBackfilled).toBe(1);
    const change = plan.changes.find((c) => c.kind === 'created_at_backfilled');
    expect(change?.permissionKey).toBe('merchandise.manage');
    expect(change?.priorState).toBe('present_without_created_at');
    expect(change?.rollback).toEqual({ op: 'restore_created_at', grantId: change?.grantId, priorCreatedAt: null });
  });

  it('mirrors the real Manor drift shape: missing + createdAt-less both counted', () => {
    let rows = convergedRows();
    // drop accounting.manage on the accounting role (missing row)
    rows = rows.filter((r) => !(r.roleId === defaultRoleFixtureId('accounting') && r.permissionKey === 'accounting.manage'));
    // strip createdAt from a merchandise grant on manager (present-but-dropped)
    rows = rows.map((r) =>
      r.roleId === defaultRoleFixtureId('manager') && r.permissionKey === 'merchandise.read' ? { ...r, createdAt: null } : r,
    );
    const plan = computeDefaultRoleReconciliationPlan(rows);
    expect(plan.summary.grantsAdded).toBe(1);
    expect(plan.summary.createdAtBackfilled).toBe(1);
    expect(plan.summary.requiredChanges).toBe(2);
  });

  it('reports duplicates, unknown keys, unexpected grants, and malformed rows WITHOUT acting on them', () => {
    const rows = convergedRows();
    // duplicate administrator case.read
    rows.push({ id: 'dup-1', roleId: defaultRoleFixtureId('administrator'), permissionKey: 'case.read', createdAt: NOW });
    // unknown/stale key
    rows.push({ id: 'stale-1', roleId: defaultRoleFixtureId('administrator'), permissionKey: 'legacy.gone', createdAt: NOW });
    // unexpected (valid key not expected on readOnly)
    rows.push({ id: 'unexp-1', roleId: defaultRoleFixtureId('readOnly'), permissionKey: 'payment.refund', createdAt: NOW });
    // malformed (no id)
    rows.push({ id: undefined, roleId: defaultRoleFixtureId('administrator'), permissionKey: 'case.read', createdAt: NOW });

    const plan = computeDefaultRoleReconciliationPlan(rows);
    expect(plan.summary.findings.duplicateGrants).toBe(1);
    expect(plan.summary.findings.unknownOrStaleKeyGrants).toBe(1);
    expect(plan.summary.findings.unexpectedGrants).toBe(1);
    expect(plan.summary.findings.malformedGrants).toBe(1);
    // None of these are auto-repaired — additive plan only touches missing/backfill.
    expect(plan.summary.grantsAdded).toBe(0);
    expect(plan.summary.createdAtBackfilled).toBe(0);
    expect(plan.summary.destructiveChanges).toBe(0);
  });

  it('applying the plan (conceptually) then re-running converges to zero — determinism', () => {
    // Start missing two grants; simulate applying by adding deterministic rows; re-run.
    const rows = convergedRows().filter(
      (r) =>
        !(r.roleId === defaultRoleFixtureId('administrator') && r.permissionKey === 'dashboard.manage') &&
        !(r.roleId === defaultRoleFixtureId('manager') && r.permissionKey === 'report.export'),
    );
    const plan1 = computeDefaultRoleReconciliationPlan(rows);
    expect(plan1.summary.requiredChanges).toBe(2);
    for (const change of plan1.changes) {
      rows.push({ id: change.grantId, roleId: change.roleId, permissionKey: change.permissionKey, createdAt: NOW });
    }
    const plan2 = computeDefaultRoleReconciliationPlan(rows);
    expect(plan2.summary.requiredChanges).toBe(0);
  });
});
