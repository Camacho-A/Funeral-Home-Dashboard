import { useQuery } from '@tanstack/react-query';
import { casesService } from '@/services/casesService';
import { useOrganization } from './useOrganization';

/**
 * Case list scalability, Phase 3 (2026-09). Tab counts — see
 * app/api/cases/counts/route.ts's own comment for how these are computed
 * server-side without downloading any Case record. Query key nests under
 * `['cases', organizationId]`, the same prefix every existing case
 * mutation already invalidates (see hooks/useCaseListPage.ts's own
 * comment) — a stage change, new case, etc. refreshes tab counts for
 * free, with no new invalidation code.
 */
export function useCaseCounts(params: { searchQuery: string }) {
  const organization = useOrganization();

  return useQuery({
    queryKey: ['cases', organization.organizationId, 'counts', { searchQuery: params.searchQuery }] as const,
    queryFn: () => casesService.counts(organization, params.searchQuery, organization.dataAdapterMode),
  });
}
