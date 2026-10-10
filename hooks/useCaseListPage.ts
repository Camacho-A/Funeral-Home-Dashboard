import { useInfiniteQuery } from '@tanstack/react-query';
import { casesService, type CaseListPage } from '@/services/casesService';
import { CASE_LIST_DEFAULT_PAGE_SIZE } from '@/lib/casePagination';
import { useOrganization } from './useOrganization';

/**
 * Case list scalability, Phase 3 (2026-09). Backs the Dashboard's active
 * tab — one bounded page at a time, via React Query's `useInfiniteQuery`
 * (the standard "Load More" shape: each `fetchNextPage()` call appends a
 * new page to `data.pages` rather than replacing it, and TanStack Query
 * itself guarantees `fetchNextPage` can't run concurrently with another
 * in-flight page fetch for the same query).
 *
 * Query key: `['cases', organizationId, 'list', { stage, searchQuery }]`
 * — nested under the exact `['cases', organizationId]` prefix every
 * existing case mutation (hooks/useCaseMutations.ts, useCreateCase.ts,
 * useAdvanceCaseStage.ts) already calls `invalidateQueries` on. React
 * Query's default prefix matching means those existing `onSuccess`
 * handlers invalidate this new query automatically — no new invalidation
 * code needed for "a case that changes stage must leave its old tab and
 * appear in its new one," "a new case must appear in All Cases," etc.
 * `stage`/`searchQuery` are both part of the key specifically so a
 * Completed query can never collide with (serve stale results into) a
 * First Call & Payment query, or an unsearched query collide with a
 * searched one.
 */
export function useCaseListPage(params: { stage: string | null; searchQuery: string; archived?: boolean }) {
  const organization = useOrganization();
  const { stage, searchQuery } = params;
  // Archived Cases (2026-10). Part of the query key, so the archived and
  // active lists are cached separately and switching views never shows
  // the other one's rows while refetching.
  const archived = params.archived === true;

  return useInfiniteQuery({
    queryKey: ['cases', organization.organizationId, 'list', { stage, searchQuery, archived }] as const,
    queryFn: ({ pageParam }) =>
      casesService.listPage(
        organization,
        { stage, searchQuery, archived, limit: CASE_LIST_DEFAULT_PAGE_SIZE, cursor: pageParam },
        organization.dataAdapterMode,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: CaseListPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
}
