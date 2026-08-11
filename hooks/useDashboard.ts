import { useQuery } from '@tanstack/react-query';
import { fetchDashboard } from '@/lib/reportsClient';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The Executive
 * Dashboard's own query hook — `/api/dashboard` already resolves every
 * section's permission gating server-side, so this hook is a plain
 * fetch, no client-side permission logic duplicated here.
 */
const dashboardKey = (organizationId: string) => ['dashboard', organizationId];

export function useDashboardData(organizationId: string) {
  return useQuery({ queryKey: dashboardKey(organizationId), queryFn: () => fetchDashboard(organizationId), enabled: Boolean(organizationId) });
}
