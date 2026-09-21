import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, queryAllWixDataItems, insertWixDataItem, updateWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import { buildWixRolePermissionData, type WixRolePermissionItem } from '../lib/wixRolePermissionMapper';
import { buildWixRbacReconciliationRecordData, type WixRbacReconciliationRecordItem } from '../lib/wixRbacReconciliationRecordMapper';
import { DEFAULT_ROLE_DEFINITIONS } from '../domain/rbac/defaultRoles';
import { defaultRoleFixtureId } from '../domain/rbac/deterministicIds';
import { computeDefaultRoleReconciliationPlan, type RawGrantRow, type ReconciliationPlan } from '../domain/rbac/reconciliationPlan';
import type { RbacReconciliationMode, RbacReconciliationRecord } from '../types/rbacReconciliationRecord';
import type { RolePermission } from '../types/rolePermission';
import type { PermissionKey } from '../domain/rbac/permissionCatalog';
import { rolePermissionFixtures } from './__mocks__/rbacFixtures';
import { rbacReconciliationRecordFixtures } from './__mocks__/rbacReconciliationFixtures';

/**
 * Phase 38 (RBAC Grant Hygiene & Authorization Integrity). Reconciles the
 * GLOBAL platform-default roles' live `rolePermissions` against the in-code
 * source of truth (`DEFAULT_ROLE_DEFINITIONS`). Purely ADDITIVE: it inserts
 * missing expected grants and backfills missing `createdAt` metadata — it
 * never deletes or overwrites a grant, so it can never strand an
 * organization of administrators and never touches organization-owned custom
 * roles (which are org-scoped and reconciled — if ever — separately). Every
 * write uses the deterministic default-grant id, so a re-run is a no-op
 * (409-as-success) and a second dry-run converges to zero changes.
 *
 * Manual invocation only (D7): nothing here runs at startup or on deploy.
 */
const ROLE_PERMISSIONS_COLLECTION = 'rolePermissions';
const RECONCILIATION_RECORDS_COLLECTION = 'rbacReconciliationRecords';
export const RECONCILIATION_ACTOR_SYSTEM = 'system:rbac-reconciliation';

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_ROLE_IDS = new Set(DEFAULT_ROLE_DEFINITIONS.map((def) => defaultRoleFixtureId(def.key)));

/** Reads the raw (pre-mapper) default-role grant rows so the planner can see
    the true `createdAt` state, including rows missing it.
    Manors go-live incident fix (2026-09): previously unpaginated — for any
    default role whose live grant count exceeds Wix Data's silent 50-item
    cap (role-administrator's real 68, first exposed by this exact
    reconciliation), this would have under-read the role's existing
    grants, causing the planner to see already-granted permissions as
    "missing" on every subsequent run. Now paginates fully via
    `queryAllWixDataItems`. */
async function readDefaultRoleGrantRows(dataAdapterMode: DataAdapterMode): Promise<RawGrantRow[]> {
  if (dataAdapterMode === 'mock') {
    return rolePermissionFixtures
      .filter((rp) => DEFAULT_ROLE_IDS.has(rp.roleId))
      .map((rp) => ({ id: rp.id, roleId: rp.roleId, permissionKey: rp.permissionKey, createdAt: rp.createdAt }));
  }
  const rows: RawGrantRow[] = [];
  for (const def of DEFAULT_ROLE_DEFINITIONS) {
    const roleId = defaultRoleFixtureId(def.key);
    const items = await queryAllWixDataItems<WixRolePermissionItem>(ROLE_PERMISSIONS_COLLECTION, { roleId });
    for (const item of items) {
      const d = item.data;
      rows.push({ id: d.beaconRolePermissionId, roleId: d.roleId, permissionKey: d.permissionKey, createdAt: d.createdAt });
    }
  }
  return rows;
}

async function insertGrantIdempotent(grant: RolePermission, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    if (!rolePermissionFixtures.some((rp) => rp.id === grant.id)) rolePermissionFixtures.push(grant);
    return;
  }
  try {
    await insertWixDataItem<WixRolePermissionItem>(ROLE_PERMISSIONS_COLLECTION, buildWixRolePermissionData(grant), grant.id);
  } catch (error) {
    // A 409 means the deterministic-id row already exists — idempotent success,
    // never an overwrite of another grant.
    if (error instanceof WixDataApiError && error.status === 409) return;
    throw error;
  }
}

async function backfillCreatedAt(
  grantId: string,
  roleId: string,
  permissionKey: PermissionKey,
  now: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const row = rolePermissionFixtures.find((rp) => rp.id === grantId);
    if (row) row.createdAt = now;
    return;
  }
  // Full-replace the row with a well-formed grant (the collection has exactly
  // these four fields, so this is complete, not a partial patch). Targets only
  // this exact grant id — never a blanket rewrite.
  await updateWixDataItem<WixRolePermissionItem>(
    ROLE_PERMISSIONS_COLLECTION,
    grantId,
    buildWixRolePermissionData({ id: grantId, roleId, permissionKey, createdAt: now }),
  );
}

async function persistRecord(record: RbacReconciliationRecord, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    rbacReconciliationRecordFixtures.push(record);
    return;
  }
  await insertWixDataItem<WixRbacReconciliationRecordItem>(
    RECONCILIATION_RECORDS_COLLECTION,
    buildWixRbacReconciliationRecordData(record),
    record.id,
  );
}

/**
 * Runs a reconciliation of the GLOBAL platform-default roles.
 * - `dry_run`: read-only. Computes and returns the plan, persists NOTHING,
 *   mutates NOTHING (D7 — dry run never touches live data).
 * - `apply`: performs the additive inserts + createdAt backfills, then
 *   persists exactly one PLATFORM-scoped reconciliation record.
 *
 * The returned record always carries the full plan (changes + summary) so a
 * caller can render the dry-run report without a second read.
 */
export async function runDefaultRoleReconciliation(
  params: { mode: RbacReconciliationMode; actor?: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<RbacReconciliationRecord> {
  const startedAt = nowIso();
  const rows = await readDefaultRoleGrantRows(dataAdapterMode);
  const now = nowIso();
  const plan = computeDefaultRoleReconciliationPlan(rows);

  if (params.mode === 'apply') {
    for (const change of plan.changes) {
      if (change.kind === 'grant_added') {
        await insertGrantIdempotent(
          { id: change.grantId, roleId: change.roleId, permissionKey: change.permissionKey, createdAt: now },
          dataAdapterMode,
        );
      } else {
        await backfillCreatedAt(change.grantId, change.roleId, change.permissionKey, now, dataAdapterMode);
      }
    }
  }

  const runId = params.idFactory();
  const record: RbacReconciliationRecord = {
    id: runId,
    runId,
    mode: params.mode,
    scopeMarker: 'PLATFORM',
    organizationId: null,
    actor: params.actor ?? RECONCILIATION_ACTOR_SYSTEM,
    summary: plan.summary,
    changes: plan.changes,
    startedAt,
    completedAt: nowIso(),
  };

  // Only an apply mutates state and is recorded; a dry run is pure inspection.
  if (params.mode === 'apply') {
    await persistRecord(record, dataAdapterMode);
  }

  return record;
}

/** READ-ONLY: computes the current default-role reconciliation plan without
    mutating or persisting anything. Shared by the integrity/health service. */
export async function inspectDefaultRoleReconciliation(dataAdapterMode: DataAdapterMode): Promise<ReconciliationPlan> {
  const rows = await readDefaultRoleGrantRows(dataAdapterMode);
  return computeDefaultRoleReconciliationPlan(rows);
}

/** Lists persisted reconciliation records (most recent first). Admin-only at
    the route layer. */
export async function listReconciliationRecords(dataAdapterMode: DataAdapterMode): Promise<RbacReconciliationRecord[]> {
  if (dataAdapterMode === 'mock') {
    return [...rbacReconciliationRecordFixtures].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }
  const response = await queryWixDataItems<WixRbacReconciliationRecordItem>(RECONCILIATION_RECORDS_COLLECTION, {
    sort: [{ fieldName: 'completedAt', order: 'DESC' }],
  });
  const { mapWixRbacReconciliationRecordItem } = await import('../lib/wixRbacReconciliationRecordMapper');
  return response.dataItems
    .map((item) => mapWixRbacReconciliationRecordItem(item.data))
    .filter((r): r is RbacReconciliationRecord => r !== null);
}
