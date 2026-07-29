import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchCaseActivity, fetchOrganizationActivity, type ActivityFilters } from '@/lib/activityClient';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). Query hooks for the
 * Case Activity tab and the Audit Center's data layer, bundled in one file
 * the same way `hooks/useRbac.ts` bundles its own closely-related
 * query/mutation set. Both lists are keyset-paginated (see ADR-028), which
 * `useInfiniteQuery` models directly: `pageParam` is the opaque cursor
 * string `activityService.ts` hands back as `nextCursor`, and
 * `getNextPageParam` simply forwards it — no page-number bookkeeping.
 * CSV export has no hook here since it isn't a query or mutation, just a
 * URL a caller navigates to; see `lib/activityClient.ts`'s
 * `buildActivityExportUrl`.
 */
const caseActivityKey = (caseId: string, organizationId: string) => ['caseActivity', organizationId, caseId];
const organizationActivityKey = (organizationId: string, filters: ActivityFilters) => ['organizationActivity', organizationId, filters];

export function useCaseActivity(caseId: string, organizationId: string) {
  return useInfiniteQuery({
    queryKey: caseActivityKey(caseId, organizationId),
    queryFn: ({ pageParam }) => fetchCaseActivity(caseId, organizationId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(caseId && organizationId),
  });
}

/**
 * `enabled` defaults to true but is deliberately a caller-supplied param
 * (not just `Boolean(organizationId)`, unlike `useCaseActivity` above) —
 * `AuditCenterPanel` passes `canReadAudit` here so this never fires for a
 * caller who lacks `audit.read`, rather than firing regardless of
 * permission and only hiding the *result*.
 */
export function useOrganizationActivity(organizationId: string, filters: ActivityFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: organizationActivityKey(organizationId, filters),
    queryFn: ({ pageParam }) => fetchOrganizationActivity(organizationId, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(organizationId) && enabled,
  });
}
