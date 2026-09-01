import type { PermissionKey } from '../domain/rbac/permissionCatalog';

/**
 * Phase 38 (RBAC Grant Hygiene & Authorization Integrity). One persisted
 * record of a single reconciliation *run* — the dedicated, auditable,
 * rollback-bearing history the migration writes (distinct from, and
 * complementary to, `organizationRoleAuditEntries`, which remains the
 * human-facing role/membership trail). A `dry_run` record captures what
 * *would* change; an `apply` record captures what *did* change, with the
 * prior/new state and rollback op for every mutation.
 *
 * D5 decision: default-role grants are GLOBAL (org-null shared roles), so a
 * global reconciliation is recorded once with an explicit `PLATFORM` scope
 * marker and `organizationId: null` — never a fake per-organization audit
 * fan-out for one shared mutation. Tenant custom-role reconciliation (if any)
 * is recorded per organization with a `TENANT` marker.
 */
export type RbacReconciliationMode = 'dry_run' | 'apply';

export type RbacReconciliationScopeMarker = 'PLATFORM' | 'TENANT';

/** The two additive repair kinds Phase 38 performs. No destructive kind is
    defined — removing an unexpected grant is out of scope and would require a
    separately-justified, separately-approved action. */
export type RbacReconciliationChangeKind = 'grant_added' | 'created_at_backfilled';

export type RbacReconciliationRoleScope = 'GLOBAL_DEFAULT_ROLE' | 'TENANT_CUSTOM_ROLE';

/** A single proposed/applied change, carrying everything needed to explain
    and reverse it. */
export type RbacReconciliationChange = {
  roleId: string;
  roleKey: string;
  roleScope: RbacReconciliationRoleScope;
  permissionKey: PermissionKey;
  kind: RbacReconciliationChangeKind;
  /** Deterministic id of the grant row this change targets. */
  grantId: string;
  /** State before the change (for audit + rollback). */
  priorState: 'absent' | 'present_without_created_at' | 'present';
  reason: string;
  /** How to reverse this change if the run must be rolled back. `delete_grant`
      removes a row this run inserted; `restore_created_at` puts back the prior
      (missing) createdAt state. Rollback targets only the exact grantId this
      run touched — never a blanket delete — so grants created after this run
      are never affected. */
  rollback:
    | { op: 'delete_grant'; grantId: string }
    | { op: 'restore_created_at'; grantId: string; priorCreatedAt: string | null };
};

/** Read-only findings a run surfaces but does NOT act on (reported, never
    auto-fixed): duplicates, malformed rows, unknown/stale keys, unexpected
    grants. Phase 38 apply is additive only. */
export type RbacReconciliationFindings = {
  duplicateGrants: number;
  malformedGrants: number;
  unknownOrStaleKeyGrants: number;
  unexpectedGrants: number;
  customRolesDetected: number;
};

export type RbacReconciliationSummary = {
  rolesScanned: number;
  expectedGrants: number;
  presentGrants: number;
  grantsAdded: number;
  createdAtBackfilled: number;
  /** Total changes this run performed (apply) or would perform (dry_run). A
      converged system yields 0 — the idempotency acceptance criterion. */
  requiredChanges: number;
  /** Destructive changes — always 0 in Phase 38 unless separately justified. */
  destructiveChanges: number;
  findings: RbacReconciliationFindings;
};

export type RbacReconciliationRecord = {
  id: string;
  runId: string;
  mode: RbacReconciliationMode;
  scopeMarker: RbacReconciliationScopeMarker;
  /** null for a PLATFORM (global default-role) run; the org id for a TENANT run. */
  organizationId: string | null;
  /** Who/what ran it — e.g. `system:rbac-reconciliation` or an admin identity id. */
  actor: string;
  summary: RbacReconciliationSummary;
  changes: RbacReconciliationChange[];
  startedAt: string;
  completedAt: string;
};
