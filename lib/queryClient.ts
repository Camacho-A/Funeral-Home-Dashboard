import { MutationCache, QueryClient } from '@tanstack/react-query';

/**
 * The one place a React Query client is configured (performance phase 1,
 * 2026-10). Used by app/providers.tsx (pages with no signed-in account,
 * e.g. /login) and by ScopedQueryClientProvider, which gives every
 * signed-in staff user + organization, and every family portal account,
 * a client of its own.
 *
 * - `staleTime` QUERY_STALE_TIME_MS: data fetched within the last 30s is
 *   reused when another screen mounts the same query or the window
 *   regains focus, instead of being fetched again. Focus refetching stays
 *   on, so anything older than that still refreshes when staff return to
 *   the tab. Explicit `refetch()` calls (refresh buttons) and
 *   `refetchInterval` polling (notifications, pending payments) ignore
 *   staleTime and behave exactly as before.
 * - Every settled mutation marks every cached query stale
 *   (`refetchType: 'none'` — nothing is refetched by this alone). Before
 *   staleTime existed, any screen mounted after a change refetched
 *   anyway; this keeps that guarantee for every mutation, including ones
 *   whose own invalidation lists miss a related view (dashboard counts,
 *   activity feeds, balances). Each mutation's own `invalidateQueries`
 *   still refetches the on-screen queries it names, exactly as before.
 * - Authorization failures (401/403) are never retried — unchanged from
 *   the previous app/providers.tsx configuration.
 */
export const QUERY_STALE_TIME_MS = 30_000;

export function isAuthorizationError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

export function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSettled: () => queryClient.invalidateQueries({ refetchType: 'none' }),
    }),
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        retry: (failureCount, error) => !isAuthorizationError(error) && failureCount < 3,
      },
    },
  });
  return queryClient;
}
