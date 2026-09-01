'use client';

import { useRbacHealth } from '@/hooks/useRbac';

/**
 * Phase 38 (RBAC Grant Hygiene & Authorization Integrity). Minimal
 * admin-facing authorization-health indicator for the Roles &amp; Permissions
 * page — intentionally small (a status pill + a one-line summary), NOT an IAM
 * console. Reads the read-only `/api/rbac/integrity/health` endpoint; a
 * non-admin caller gets a 403 and simply sees nothing. No identity or
 * cross-tenant detail is shown.
 */
const STATUS_LABEL: Record<string, string> = {
  HEALTHY: 'Authorization healthy',
  DRIFT_DETECTED: 'Drift detected',
  MALFORMED_DATA: 'Malformed grant data',
  DUPLICATES: 'Duplicate grants',
  MISSING_DEFAULT_GRANTS: 'Missing default grants',
};

export function RbacHealthBadge({ organizationId }: { organizationId: string }) {
  const { data, isPending, isError } = useRbacHealth(organizationId);

  // Silent when unavailable (e.g. a non-admin 403) — this is a diagnostic aid,
  // never a blocker.
  if (isPending || isError || !data) return null;

  const healthy = data.status === 'HEALTHY';
  const label = STATUS_LABEL[data.status] ?? data.status;

  return (
    <div
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.25rem 0.625rem',
        borderRadius: '999px',
        fontSize: '0.8125rem',
        fontWeight: 600,
        color: healthy ? '#0f5132' : '#664d03',
        backgroundColor: healthy ? '#d1e7dd' : '#fff3cd',
        border: `1px solid ${healthy ? '#a3cfbb' : '#ffe69c'}`,
      }}
    >
      <span aria-hidden="true">{healthy ? '✓' : '⚠'}</span>
      <span>{label}</span>
      {!healthy && (
        <span style={{ fontWeight: 400 }}>
          ({data.counts.missingDefaultGrants} missing, {data.counts.createdAtToBackfill} to repair)
        </span>
      )}
    </div>
  );
}
