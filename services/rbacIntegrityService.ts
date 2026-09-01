import type { DataAdapterMode } from '../lib/env';
import { inspectDefaultRoleReconciliation } from './rbacReconciliationService';
import { getMembership, isActiveMembership } from './membershipService';
import { resolveRoleForKey, resolvePermissionKeysForRole } from './permissionService';
import { isDefaultRoleKey, defaultRoleDefinition } from '../domain/rbac/defaultRoles';
import { resolveRoleKeyAlias } from '../domain/rbac/legacyRoleAliases';
import { PERMISSION_KEYS, type PermissionKey } from '../domain/rbac/permissionCatalog';

/**
 * Phase 38 (RBAC Grant Hygiene & Authorization Integrity). READ-ONLY
 * authorization-integrity diagnostics: a deterministic health check over the
 * global default-role grants, and a per-role/per-member "why is this
 * unauthorized?" trace (Identity → Membership → role → expected → persisted →
 * effective). Mutates nothing; the route layer gates it behind
 * `organization.manage`. Deliberately narrow — a diagnostic, not an IAM
 * console.
 */
export type RbacHealthStatus =
  | 'HEALTHY'
  | 'DRIFT_DETECTED'
  | 'MALFORMED_DATA'
  | 'DUPLICATES'
  | 'MISSING_DEFAULT_GRANTS';

export type RbacHealthReport = {
  status: RbacHealthStatus;
  /** All conditions that were detected, most-severe first — `status` is the
      top one. Empty when HEALTHY. */
  conditions: RbacHealthStatus[];
  counts: {
    rolesScanned: number;
    expectedGrants: number;
    presentGrants: number;
    missingDefaultGrants: number;
    createdAtToBackfill: number;
    duplicateGrants: number;
    malformedGrants: number;
    unknownOrStaleKeyGrants: number;
    unexpectedGrants: number;
  };
};

export async function checkRbacHealth(dataAdapterMode: DataAdapterMode): Promise<RbacHealthReport> {
  const plan = await inspectDefaultRoleReconciliation(dataAdapterMode);
  const s = plan.summary;
  const f = s.findings;

  // Severity order: malformed/unknown data first (a security-critical signal),
  // then duplicates, then missing default grants, then softer drift.
  const conditions: RbacHealthStatus[] = [];
  if (f.malformedGrants > 0 || f.unknownOrStaleKeyGrants > 0) conditions.push('MALFORMED_DATA');
  if (f.duplicateGrants > 0) conditions.push('DUPLICATES');
  if (s.grantsAdded > 0) conditions.push('MISSING_DEFAULT_GRANTS');
  if (s.createdAtBackfilled > 0 || f.unexpectedGrants > 0) conditions.push('DRIFT_DETECTED');

  const status: RbacHealthStatus = conditions[0] ?? 'HEALTHY';

  return {
    status,
    conditions,
    counts: {
      rolesScanned: s.rolesScanned,
      expectedGrants: s.expectedGrants,
      presentGrants: s.presentGrants,
      missingDefaultGrants: s.grantsAdded,
      createdAtToBackfill: s.createdAtBackfilled,
      duplicateGrants: f.duplicateGrants,
      malformedGrants: f.malformedGrants,
      unknownOrStaleKeyGrants: f.unknownOrStaleKeyGrants,
      unexpectedGrants: f.unexpectedGrants,
    },
  };
}

export type PermissionResolution = {
  permissionKey: PermissionKey;
  expected: boolean;
  effective: boolean;
  /** True when expected but not effective — the actionable "why unauthorized". */
  missing: boolean;
};

export type RoleAuthorizationDiagnosis = {
  roleKey: string;
  resolvedRoleKey: string;
  roleId: string | null;
  roleResolved: boolean;
  isDefaultRole: boolean;
  expectedCount: number;
  effectiveCount: number;
  missingPermissions: PermissionKey[];
  /** Present-and-effective but not expected (custom roles legitimately differ). */
  extraPermissions: PermissionKey[];
  permissions: PermissionResolution[];
};

/**
 * Diagnoses one role's authorization. "Expected" is the source-of-truth grant
 * set for a default role (`DEFAULT_ROLE_DEFINITIONS`); for a custom role there
 * is no external expectation, so expected == effective (a custom role is
 * authoritative over its own grants — never "missing" anything). "Effective"
 * is what the live authorization pipeline actually resolves.
 */
export async function diagnoseRoleAuthorization(
  roleKey: string,
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<RoleAuthorizationDiagnosis> {
  const resolvedRoleKey = resolveRoleKeyAlias(roleKey);
  const role = await resolveRoleForKey(roleKey, organizationId, dataAdapterMode);
  const effectiveSet = await resolvePermissionKeysForRole(roleKey, organizationId, dataAdapterMode);
  const isDefault = isDefaultRoleKey(resolvedRoleKey);

  const expectedSet: Set<PermissionKey> = isDefault
    ? new Set(defaultRoleDefinition(resolvedRoleKey).permissions)
    : new Set(effectiveSet); // custom role: its own live grants are authoritative

  const permissions: PermissionResolution[] = PERMISSION_KEYS.map((key) => {
    const expected = expectedSet.has(key);
    const effective = effectiveSet.has(key);
    return { permissionKey: key, expected, effective, missing: expected && !effective };
  });

  return {
    roleKey,
    resolvedRoleKey,
    roleId: role?.id ?? null,
    roleResolved: role !== null,
    isDefaultRole: isDefault,
    expectedCount: expectedSet.size,
    effectiveCount: effectiveSet.size,
    missingPermissions: permissions.filter((p) => p.missing).map((p) => p.permissionKey),
    extraPermissions: permissions.filter((p) => p.effective && !p.expected).map((p) => p.permissionKey),
    permissions,
  };
}

export type MemberAuthorizationDiagnosis = {
  identityId: string;
  organizationId: string;
  membershipFound: boolean;
  membershipActive: boolean;
  roleKey: string | null;
  role: RoleAuthorizationDiagnosis | null;
};

/**
 * Diagnoses one member's effective authorization by resolving their active
 * membership's role, then diagnosing that role. Answers "why does this
 * administrator get unauthorized?" end-to-end without exposing secrets.
 */
export async function diagnoseMemberAuthorization(
  identityId: string,
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<MemberAuthorizationDiagnosis> {
  const membership = await getMembership(identityId, organizationId, dataAdapterMode);
  if (!membership) {
    return { identityId, organizationId, membershipFound: false, membershipActive: false, roleKey: null, role: null };
  }
  const active = isActiveMembership(membership);
  const role = await diagnoseRoleAuthorization(membership.role, organizationId, dataAdapterMode);
  return {
    identityId,
    organizationId,
    membershipFound: true,
    membershipActive: active,
    roleKey: membership.role,
    role,
  };
}
