import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, waitFor, act } from '@testing-library/react';
import {
  QueryClientProvider,
  QueryObserver,
  MutationObserver,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { createQueryClient, QUERY_STALE_TIME_MS, isAuthorizationError } from './queryClient';
import { ScopedQueryClientProvider } from '@/components/providers/ScopedQueryClientProvider';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { casesService } from '@/services/casesService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/**
 * Performance phase 1 (2026-10) — the shared React Query configuration:
 * cached data is reused for QUERY_STALE_TIME_MS, every mutation marks the
 * cache stale so later screens refetch exactly as they did before
 * staleTime existed, explicit refreshes and polling still fetch, and each
 * signed-in account gets its own cache.
 */

vi.mock('@/services/casesService', () => ({
  casesService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('@/hooks/useWorkflowTemplates', () => ({
  useWorkflowTemplates: () => ({ data: [{ id: 'template-1', isEnabled: true }] }),
}));

async function fetchThrough(
  client: QueryClient,
  queryKey: unknown[],
  queryFn: () => Promise<unknown>,
) {
  const observer = new QueryObserver(client, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  await waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
  return { observer, unsubscribe };
}

describe('createQueryClient defaults', () => {
  it(`reuses data fetched within ${QUERY_STALE_TIME_MS / 1000}s when another screen mounts the same query`, async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => ['case-1']);
    const first = await fetchThrough(client, ['cases', 'org-a'], queryFn);
    first.unsubscribe();

    const second = await fetchThrough(client, ['cases', 'org-a'], queryFn);
    second.unsubscribe();

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('refetches once the data is older than the stale time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const client = createQueryClient();
      const queryFn = vi.fn(async () => ['case-1']);
      (await fetchThrough(client, ['cases', 'org-a'], queryFn)).unsubscribe();
      vi.advanceTimersByTime(QUERY_STALE_TIME_MS + 1);
      (await fetchThrough(client, ['cases', 'org-a'], queryFn)).unsubscribe();
      await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('an explicit refresh (refetch) always fetches, regardless of the stale time', async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => ['case-1']);
    const { observer, unsubscribe } = await fetchThrough(client, ['cases', 'org-a'], queryFn);
    await observer.refetch();
    unsubscribe();
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('polling (refetchInterval) keeps fetching on schedule, regardless of the stale time', async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => 3);
    const observer = new QueryObserver(client, {
      queryKey: ['notificationUnreadCount', 'org-a'],
      queryFn,
      refetchInterval: 20,
    });
    const unsubscribe = observer.subscribe(() => {});
    await waitFor(() => expect(queryFn.mock.calls.length).toBeGreaterThanOrEqual(3), {
      timeout: 2000,
    });
    unsubscribe();
  });

  it('every successful mutation marks every cached query stale without refetching inactive ones', async () => {
    const client = createQueryClient();
    const dashboardFn = vi.fn(async () => ({ activeCases: 1 }));
    (await fetchThrough(client, ['dashboard', 'org-a'], dashboardFn)).unsubscribe();
    expect(client.getQueryState(['dashboard', 'org-a'])?.isInvalidated).toBe(false);

    await new MutationObserver(client, { mutationFn: async () => 'ok' }).mutate();

    await waitFor(() =>
      expect(client.getQueryState(['dashboard', 'org-a'])?.isInvalidated).toBe(true),
    );
    expect(dashboardFn).toHaveBeenCalledTimes(1);

    // …so the next screen that shows it fetches fresh data, as before staleTime.
    (await fetchThrough(client, ['dashboard', 'org-a'], dashboardFn)).unsubscribe();
    await waitFor(() => expect(dashboardFn).toHaveBeenCalledTimes(2));
  });

  it('a failed mutation also marks the cache stale (a partial write may have happened)', async () => {
    const client = createQueryClient();
    (await fetchThrough(client, ['casePayments', 'org-a', 'case-1'], async () => [])).unsubscribe();
    await new MutationObserver(client, {
      mutationFn: async () => Promise.reject(new Error('boom')),
    })
      .mutate()
      .catch(() => {});
    await waitFor(() =>
      expect(client.getQueryState(['casePayments', 'org-a', 'case-1'])?.isInvalidated).toBe(true),
    );
  });

  it('never retries authorization failures, still retries other errors', () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries!.retry as (
      count: number,
      error: unknown,
    ) => boolean;
    expect(retry(0, Object.assign(new Error('x'), { status: 401 }))).toBe(false);
    expect(retry(0, Object.assign(new Error('x'), { status: 403 }))).toBe(false);
    expect(retry(0, new Error('network'))).toBe(true);
    expect(retry(3, new Error('network'))).toBe(false);
    expect(isAuthorizationError({ status: 403 })).toBe(true);
  });
});

describe('ScopedQueryClientProvider — one cache per signed-in account', () => {
  function Capture({ onClient }: { onClient: (client: QueryClient) => void }) {
    onClient(useQueryClient());
    return null;
  }

  it('a different account or organization gets a brand-new, empty cache', () => {
    const seen: QueryClient[] = [];
    const { rerender } = render(
      <ScopedQueryClientProvider key="staff:alice:managed-cremations">
        <Capture onClient={(c) => seen.push(c)} />
      </ScopedQueryClientProvider>,
    );
    seen[0].setQueryData(['myPermissions', 'managed-cremations'], ['case.read']);

    rerender(
      <ScopedQueryClientProvider key="staff:bob:managed-cremations">
        <Capture onClient={(c) => seen.push(c)} />
      </ScopedQueryClientProvider>,
    );
    const bobClient = seen[seen.length - 1];
    expect(bobClient).not.toBe(seen[0]);
    expect(bobClient.getQueryData(['myPermissions', 'managed-cremations'])).toBeUndefined();
  });

  it('the same account and organization keeps its cache across re-renders', () => {
    const seen: QueryClient[] = [];
    const tree = (
      <ScopedQueryClientProvider key="staff:alice:managed-cremations">
        <Capture onClient={(c) => seen.push(c)} />
      </ScopedQueryClientProvider>
    );
    const { rerender } = render(tree);
    rerender(tree);
    expect(seen[0]).toBe(seen[seen.length - 1]);
  });

  it('signing out (leaving the portal) discards the cache entirely', () => {
    const seen: QueryClient[] = [];
    const portal = (
      <ScopedQueryClientProvider key="staff:alice:managed-cremations">
        <Capture onClient={(c) => seen.push(c)} />
      </ScopedQueryClientProvider>
    );
    const { rerender } = render(portal);
    seen[0].setQueryData(['notificationInbox', 'managed-cremations'], ['private']);
    rerender(<div>login page</div>);
    rerender(portal);
    expect(seen[seen.length - 1]).not.toBe(seen[0]);
    expect(
      seen[seen.length - 1].getQueryData(['notificationInbox', 'managed-cremations']),
    ).toBeUndefined();
  });
});

describe('case mutations refresh the cache under the new defaults', () => {
  beforeEach(() => vi.mocked(casesService.create).mockReset());

  function wrapperFor(client: QueryClient) {
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
            {children}
          </OrganizationProvider>
        </QueryClientProvider>
      );
    }
    return Wrapper;
  }

  it('creating a case refetches the case list and marks the dashboard and activity stale', async () => {
    const client = createQueryClient();
    const listFn = vi.fn(async () => [caseFixtures[0]]);
    const casesObserver = new QueryObserver(client, {
      queryKey: ['cases', DEFAULT_ORGANIZATION_ID],
      queryFn: listFn,
    });
    const stopCases = casesObserver.subscribe(() => {});
    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(1));
    (
      await fetchThrough(client, ['dashboard', DEFAULT_ORGANIZATION_ID], async () => ({}))
    ).unsubscribe();
    (
      await fetchThrough(client, ['organizationActivity', DEFAULT_ORGANIZATION_ID], async () => [])
    ).unsubscribe();

    vi.mocked(casesService.create).mockResolvedValue(caseFixtures[0]);
    const { useCreateCase } = await import('@/hooks/useCreateCase');
    const { result } = renderHook(() => useCreateCase(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({} as never);
    });

    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(['dashboard', DEFAULT_ORGANIZATION_ID])?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(['organizationActivity', DEFAULT_ORGANIZATION_ID])?.isInvalidated,
    ).toBe(true);
    stopCases();
  });

  it('updating a case marks the case list, case detail and dashboard stale for the next screen', async () => {
    const client = createQueryClient();
    const caseId = caseFixtures[0].id;
    (
      await fetchThrough(
        client,
        ['case', DEFAULT_ORGANIZATION_ID, caseId],
        async () => caseFixtures[0],
      )
    ).unsubscribe();
    (
      await fetchThrough(client, ['dashboard', DEFAULT_ORGANIZATION_ID], async () => ({}))
    ).unsubscribe();
    vi.mocked(casesService.update).mockResolvedValue({
      ...caseFixtures[0],
      notes: 'updated',
    } as never);

    const { useCaseMutations } = await import('@/hooks/useCaseMutations');
    const { result } = renderHook(() => useCaseMutations(caseId), { wrapper: wrapperFor(client) });
    act(() => {
      result.current.updateCaseInfo({ notes: 'updated' } as never);
    });
    await waitFor(() => expect(casesService.update).toHaveBeenCalled());

    await waitFor(() =>
      expect(client.getQueryState(['dashboard', DEFAULT_ORGANIZATION_ID])?.isInvalidated).toBe(
        true,
      ),
    );
    expect(client.getQueryState(['case', DEFAULT_ORGANIZATION_ID, caseId])?.isInvalidated).toBe(
      true,
    );
  });
});
