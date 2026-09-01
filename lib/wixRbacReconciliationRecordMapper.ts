import type {
  RbacReconciliationChange,
  RbacReconciliationMode,
  RbacReconciliationRecord,
  RbacReconciliationScopeMarker,
  RbacReconciliationSummary,
} from '../types/rbacReconciliationRecord';

/**
 * Phase 38 (RBAC Grant Hygiene). Maps one `rbacReconciliationRecords` Wix
 * row. The structured `summary` and `changes` (variable-length, nested) are
 * persisted JSON-encoded in Text columns — the same convention used elsewhere
 * for nested Wix data (e.g. variant `optionValues`, notification
 * `categoryOverrides`) — so the collection stays within the flat-field model.
 * Security-critical scalars (`beaconRbacReconciliationRecordId`, `runId`,
 * `mode`, `scopeMarker`) fail closed; a row whose JSON blobs are unparseable
 * degrades to an empty summary/changes rather than dropping the whole record.
 */
const VALID_MODES: RbacReconciliationMode[] = ['dry_run', 'apply'];
const VALID_SCOPES: RbacReconciliationScopeMarker[] = ['PLATFORM', 'TENANT'];

function isMode(value: unknown): value is RbacReconciliationMode {
  return typeof value === 'string' && (VALID_MODES as string[]).includes(value);
}
function isScopeMarker(value: unknown): value is RbacReconciliationScopeMarker {
  return typeof value === 'string' && (VALID_SCOPES as string[]).includes(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_SUMMARY: RbacReconciliationSummary = {
  rolesScanned: 0,
  expectedGrants: 0,
  presentGrants: 0,
  grantsAdded: 0,
  createdAtBackfilled: 0,
  requiredChanges: 0,
  destructiveChanges: 0,
  findings: { duplicateGrants: 0, malformedGrants: 0, unknownOrStaleKeyGrants: 0, unexpectedGrants: 0, customRolesDetected: 0 },
};

export type WixRbacReconciliationRecordItem = {
  beaconRbacReconciliationRecordId?: unknown;
  runId?: unknown;
  mode?: unknown;
  scopeMarker?: unknown;
  organizationId?: unknown;
  actor?: unknown;
  summaryJson?: unknown;
  changesJson?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
};

export function mapWixRbacReconciliationRecordItem(item: WixRbacReconciliationRecordItem | undefined): RbacReconciliationRecord | null {
  if (
    !item ||
    typeof item.beaconRbacReconciliationRecordId !== 'string' ||
    typeof item.runId !== 'string' ||
    !isMode(item.mode) ||
    !isScopeMarker(item.scopeMarker) ||
    typeof item.actor !== 'string' ||
    typeof item.startedAt !== 'string' ||
    typeof item.completedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconRbacReconciliationRecordId,
    runId: item.runId,
    mode: item.mode,
    scopeMarker: item.scopeMarker,
    organizationId: typeof item.organizationId === 'string' ? item.organizationId : null,
    actor: item.actor,
    summary: parseJson<RbacReconciliationSummary>(item.summaryJson, EMPTY_SUMMARY),
    changes: parseJson<RbacReconciliationChange[]>(item.changesJson, []),
    startedAt: item.startedAt,
    completedAt: item.completedAt,
  };
}

export function buildWixRbacReconciliationRecordData(record: RbacReconciliationRecord): WixRbacReconciliationRecordItem {
  return {
    beaconRbacReconciliationRecordId: record.id,
    runId: record.runId,
    mode: record.mode,
    scopeMarker: record.scopeMarker,
    // A PLATFORM (global) run stores null — no per-org fan-out (D5).
    organizationId: record.organizationId,
    actor: record.actor,
    summaryJson: JSON.stringify(record.summary),
    changesJson: JSON.stringify(record.changes),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  };
}
