import { isPermissionKey, type PermissionKey } from './permissionCatalog';
import { DEFAULT_ROLE_DEFINITIONS } from './defaultRoles';
import { defaultRoleFixtureId, defaultRolePermissionFixtureId } from './deterministicIds';
import type {
  RbacReconciliationChange,
  RbacReconciliationFindings,
  RbacReconciliationSummary,
} from '../../types/rbacReconciliationRecord';

/**
 * Phase 38 (RBAC Grant Hygiene). PURE reconciliation planner — no I/O. Given
 * the raw live grant rows for the platform-default roles, compute the additive
 * changes needed to bring them into agreement with `DEFAULT_ROLE_DEFINITIONS`
 * (the source of truth), plus read-only findings. Deterministic and
 * idempotent by construction: a converged input yields zero changes.
 *
 * "Raw" means the persistence-layer shape *before* the mapper normalizes it —
 * `createdAt` may be missing/non-string, which is exactly the metadata defect
 * this planner detects and repairs. Security-critical malformation (missing
 * id/roleId, or a permissionKey not in the catalog) is *reported*, never
 * silently repaired.
 */
export type RawGrantRow = {
  id: unknown;
  roleId: unknown;
  permissionKey: unknown;
  createdAt: unknown;
};

export type ReconciliationPlan = {
  changes: RbacReconciliationChange[];
  summary: RbacReconciliationSummary;
};

function hasValidCreatedAt(row: RawGrantRow): boolean {
  return typeof row.createdAt === 'string' && row.createdAt.length > 0;
}

export function computeDefaultRoleReconciliationPlan(liveRows: RawGrantRow[]): ReconciliationPlan {
  const changes: RbacReconciliationChange[] = [];
  const findings: RbacReconciliationFindings = {
    duplicateGrants: 0,
    malformedGrants: 0,
    unknownOrStaleKeyGrants: 0,
    unexpectedGrants: 0,
    customRolesDetected: 0,
  };

  // Index live rows by roleId (only rows with a usable string roleId; others
  // are malformed and reported).
  const rowsByRoleId = new Map<string, RawGrantRow[]>();
  for (const row of liveRows) {
    if (typeof row.id !== 'string' || typeof row.roleId !== 'string') {
      findings.malformedGrants++;
      continue;
    }
    if (!rowsByRoleId.has(row.roleId)) rowsByRoleId.set(row.roleId, []);
    rowsByRoleId.get(row.roleId)!.push(row);
  }

  let expectedGrants = 0;
  let presentGrants = 0;
  let grantsAdded = 0;
  let createdAtBackfilled = 0;

  for (const definition of DEFAULT_ROLE_DEFINITIONS) {
    const roleId = defaultRoleFixtureId(definition.key);
    const rows = rowsByRoleId.get(roleId) ?? [];
    const expected = new Set<PermissionKey>(definition.permissions);
    expectedGrants += expected.size;

    // Present valid keys + duplicate/invalid detection for this role.
    const presentValidKeys = new Set<string>();
    const seenKeys = new Set<string>();
    for (const row of rows) {
      const key = row.permissionKey;
      if (!isPermissionKey(key)) {
        findings.unknownOrStaleKeyGrants++;
        continue; // stale/unknown key: reported, never repaired (fail closed)
      }
      if (seenKeys.has(key)) {
        findings.duplicateGrants++;
      } else {
        seenKeys.add(key);
        presentValidKeys.add(key);
        presentGrants++;
        if (!expected.has(key)) findings.unexpectedGrants++;
      }
      // Metadata repair: a valid present grant missing createdAt.
      if (!hasValidCreatedAt(row)) {
        createdAtBackfilled++;
        changes.push({
          roleId,
          roleKey: definition.key,
          roleScope: 'GLOBAL_DEFAULT_ROLE',
          permissionKey: key,
          kind: 'created_at_backfilled',
          grantId: row.id as string,
          priorState: 'present_without_created_at',
          reason: 'valid grant present but missing createdAt metadata (mapper would historically drop it)',
          rollback: { op: 'restore_created_at', grantId: row.id as string, priorCreatedAt: null },
        });
      }
    }

    // Missing expected grants → additive insert with the deterministic id.
    for (const key of definition.permissions) {
      if (!presentValidKeys.has(key)) {
        grantsAdded++;
        const grantId = defaultRolePermissionFixtureId(definition.key, key);
        changes.push({
          roleId,
          roleKey: definition.key,
          roleScope: 'GLOBAL_DEFAULT_ROLE',
          permissionKey: key,
          kind: 'grant_added',
          grantId,
          priorState: 'absent',
          reason: 'expected default-role grant missing from live materialization',
          rollback: { op: 'delete_grant', grantId },
        });
      }
    }
  }

  const requiredChanges = grantsAdded + createdAtBackfilled;
  const summary: RbacReconciliationSummary = {
    rolesScanned: DEFAULT_ROLE_DEFINITIONS.length,
    expectedGrants,
    presentGrants,
    grantsAdded,
    createdAtBackfilled,
    requiredChanges,
    destructiveChanges: 0,
    findings,
  };

  return { changes, summary };
}
