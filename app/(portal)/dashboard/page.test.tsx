import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';
import * as reportsClient from '@/lib/reportsClient';
import type { DashboardResult } from '@/services/dashboardService';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { CaseSearchContext, useCaseSearch } from '@/hooks/useCaseSearch';
import { casesService } from '@/services/casesService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Case } from '@/types/case';

/**
 * Manors go-live cleanup (2026-09) — the Main Dashboard's own page-level
 * test file (none existed before this task). Mocks
 * lib/reportsClient.ts#fetchDashboard directly (the same "mock the client
 * fetch function" pattern app/family/(portal)/dashboard/page.test.tsx
 * already established) — everything else (cases, staff, organization
 * context) uses the real mock adapter and its shared fixtures, matching
 * how the rest of this app's page-level tests already run.
 */
vi.mock('@/lib/reportsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reportsClient')>('@/lib/reportsClient');
  return { ...actual, fetchDashboard: vi.fn() };
});

/**
 * Case list scalability, Phase 3 (2026-09). The active tab is reflected
 * in the URL (`?tab=<STAGES label>`), which needs `next/navigation`'s
 * router hooks — mocked the same way app/family/login/page.test.tsx
 * already does for its own `useRouter`/`useSearchParams` usage.
 */
let searchParams = new URLSearchParams();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/dashboard',
  useSearchParams: () => searchParams,
}));

const BASE_DASHBOARD: DashboardResult = {
  today: { unreadNotifications: 0, appointmentsToday: 0 },
  operations: null,
  financial: null,
  attention: null,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

/** Case list scalability, Phase 3 (2026-09): the new tabbed-list tests
    below need precise control over which cases exist, so they render
    against a second, dedicated organization (never DEFAULT_ORGANIZATION_ID's
    real seed data) and return the QueryClient so a test can also drive
    cache invalidation directly. */
function renderPageForOrg(organizationId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={organizationId}>
        <DashboardPage />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

const pushedIds: string[] = [];

function pushCase(id: string, overrides: Partial<Case> & { caseNumber: string; createdAt: string }) {
  const template = caseFixtures.find((c) => c.organizationId !== SECOND_MOCK_ORGANIZATION_ID && !c.isDeleted)!;
  caseFixtures.push({
    ...template,
    // The cloned template is itself stalled (it drives the real "Waiting
    // on ... release" summary text seen elsewhere) — defaulted to false
    // here so a pushed test fixture doesn't also surface in
    // NeedsAttentionPanel (a legacy-fetch-all-driven, unrelated section —
    // see DashboardPageContent's own comment) and collide with this same
    // decedent name appearing in the tabbed list too. Tests that actually
    // want to exercise "needs attention" can still override it.
    isStalled: false,
    ...overrides,
    id,
    organizationId: SECOND_MOCK_ORGANIZATION_ID,
    isDeleted: overrides.isDeleted ?? false,
  });
  pushedIds.push(id);
}

afterEach(() => {
  // Explicit, FIRST: unmount every rendered tree before touching shared
  // fixture state below — otherwise a still-mounted component from this
  // test can read `caseFixtures` mid-splice (or immediately after), which
  // is what caused this file's original cross-test flakiness.
  cleanup();
  // `restoreAllMocks` (not just `clearAllMocks`): several tests below use
  // `vi.spyOn(casesService, 'listPage'/'counts')` and restore it manually
  // at the end of their own test body — but a test that throws/fails
  // BEFORE reaching that line never runs it, permanently leaving the spy
  // (and whatever custom `.mockImplementation` it had) active for every
  // later test in this file. `clearAllMocks` only resets call history, not
  // implementations, so it can't fix that; `restoreAllMocks` unconditionally
  // puts every spied module function back exactly once per test.
  vi.restoreAllMocks();
  searchParams = new URLSearchParams();
  while (pushedIds.length > 0) {
    const id = pushedIds.pop()!;
    const index = caseFixtures.findIndex((c) => c.id === id);
    if (index !== -1) caseFixtures.splice(index, 1);
  }
});

describe('DashboardPage — lower "Attention" section removed (Manors go-live cleanup, 2026-09)', () => {
  it('1. never renders the lower "Attention" card, even when the API returns attention data', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue({
      ...BASE_DASHBOARD,
      attention: { overdueCases: 3, overdueTasks: 2, outstandingSignatures: 1, failedPayments: 1 },
    });
    renderPage();

    await waitFor(() => expect(screen.queryByText('Loading financial summary…')).not.toBeInTheDocument());
    expect(screen.queryByText('Attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Overdue tasks')).not.toBeInTheDocument();
    expect(screen.queryByText('Outstanding signatures')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed payments')).not.toBeInTheDocument();
  });

  it('2. the upper "Needs Attention" panel remains present regardless of the lower section', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
  });
});

describe('DashboardPage — Financial Summary expanded layout (Manors go-live cleanup, 2026-09)', () => {
  it('4/5. renders the real Financial Summary figures unchanged, in their own full-width section', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue({
      ...BASE_DASHBOARD,
      financial: { grossRevenue: 500000, cashCollected: 350000, accountsReceivableTotal: 150000 },
    });
    renderPage();

    expect(await screen.findByText('Financial summary')).toBeInTheDocument();
    expect(screen.getByText('$5000.00')).toBeInTheDocument();
    expect(screen.getByText('$3500.00')).toBeInTheDocument();
    expect(screen.getByText('$1500.00')).toBeInTheDocument();
  });

  it('6. shows a loading placeholder while the dashboard query is still pending', async () => {
    let resolveFetch!: (value: DashboardResult) => void;
    vi.mocked(reportsClient.fetchDashboard).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderPage();

    expect(screen.getByText('Loading financial summary…')).toBeInTheDocument();
    expect(screen.queryByText('Financial summary')).not.toBeInTheDocument();

    resolveFetch({ ...BASE_DASHBOARD, financial: { grossRevenue: 100, cashCollected: 100, accountsReceivableTotal: 0 } });
    await waitFor(() => expect(screen.getByText('Financial summary')).toBeInTheDocument());
  });

  it('8. shows an error placeholder if the dashboard query fails, without leaving a broken layout', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText('Unable to load the financial summary right now.')).toBeInTheDocument();
    expect(screen.queryByText('Financial summary')).not.toBeInTheDocument();
  });

  it('7/9/10. a role without financial access (financial: null) shows no panel and no empty box — the section collapses entirely', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD); // financial: null, as an Office Staff caller would receive
    renderPage();

    await waitFor(() => expect(screen.queryByText('Loading financial summary…')).not.toBeInTheDocument());
    expect(screen.queryByText('Financial summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Unable to load the financial summary right now.')).not.toBeInTheDocument();
  });

  it('9. a role without financial access never gains it merely because the layout changed — same null-gated visibility as before', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue({
      ...BASE_DASHBOARD,
      attention: { overdueCases: 1, overdueTasks: 0, outstandingSignatures: 0, failedPayments: 0 },
      financial: null,
    });
    renderPage();

    await waitFor(() => expect(screen.queryByText('Loading financial summary…')).not.toBeInTheDocument());
    expect(screen.queryByText('Financial summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('11. the expanded section imposes no fixed/desktop-only width — FinancialSummaryPanel\'s own responsive flex-wrap stats render unchanged', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue({
      ...BASE_DASHBOARD,
      financial: { grossRevenue: 100, cashCollected: 100, accountsReceivableTotal: 0 },
    });
    renderPage();

    const heading = await screen.findByText('Financial summary');
    const panel = heading.parentElement!;
    const section = panel.parentElement;
    expect(section?.getAttribute('style')).toBeNull(); // no inline width/fixed sizing introduced
    // The panel's own 3 stat links (Gross revenue/Cash collected/Accounts
    // receivable) are still present and unaltered — the flex-wrap
    // mechanism they already relied on for narrow viewports is untouched.
    expect(within(panel).getAllByRole('link')).toHaveLength(3);
  });
});

/**
 * Case list scalability, Phase 3 (2026-09). The 8-tab case list —
 * integration-level coverage against the real mock adapter, a dedicated
 * organization (never DEFAULT_ORGANIZATION_ID's real seed data), and
 * temporarily-pushed fixtures so every assertion is exact.
 */
describe('DashboardPage — tabs (Case list scalability, Phase 3)', () => {
  it('1. renders exactly 8 tabs', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(8));
  });

  it('2. "All Cases" is the default tab', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await waitFor(() => expect(screen.getByRole('tab', { name: /All Cases/ })).toHaveAttribute('aria-selected', 'true'));
  });

  it('4/7. only the active tab\'s panel is displayed, and switching tabs never mixes results', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    pushCase('fc-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'FIRSTCALL DECEDENT', rawStage: 0 });
    pushCase('completed-1', { caseNumber: 'B2026-102', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'COMPLETED DECEDENT', rawStage: 7 });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    // All Cases (the default) legitimately shows both — isolation is a
    // property of a STAGE tab, not of All Cases itself.
    await screen.findByText('FIRSTCALL DECEDENT');
    await screen.findByText('COMPLETED DECEDENT');

    fireEvent.click(screen.getByRole('tab', { name: /^First Call & Payment/ }));
    // Both in the SAME waitFor — "COMPLETED DECEDENT absent" would
    // trivially (and wrongly) pass while the panel still shows its
    // "Loading cases…" placeholder.
    await waitFor(() => {
      expect(screen.queryByText('COMPLETED DECEDENT')).not.toBeInTheDocument();
      expect(screen.getByText('FIRSTCALL DECEDENT')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /^Completed/ }));
    await waitFor(() => {
      expect(screen.getByText('COMPLETED DECEDENT')).toBeInTheDocument();
      expect(screen.queryByText('FIRSTCALL DECEDENT')).not.toBeInTheDocument();
    });
  });

  it('5. initial Dashboard load requests only the active (All Cases) list, never all eight', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    pushCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 0 });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    await waitFor(() => expect(listPageSpy).toHaveBeenCalled());
    const stagesRequested = new Set(listPageSpy.mock.calls.map((call) => call[1]?.stage ?? null));
    expect(stagesRequested.size).toBe(1);
    expect(stagesRequested.has(null)).toBe(true);
    listPageSpy.mockRestore();
  });

  it('6. selecting a stage tab requests only that stage', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    pushCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByRole('tab', { name: /All Cases/ });

    fireEvent.click(screen.getByRole('tab', { name: /Completed/ }));
    await waitFor(() => expect(listPageSpy.mock.calls.some((call) => call[1]?.stage === 'Completed')).toBe(true));
    listPageSpy.mockRestore();
  });

  it('8. tab counts render from the server-side counts data, not the loaded page', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    for (let i = 0; i < 3; i++) {
      pushCase(`c-${i}`, { caseNumber: `B2026-${100 + i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z`, rawStage: 7 });
    }
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Completed/ }).textContent).toContain('3'));
  });

  it('9. an empty stage renders "No cases in this stage."', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    fireEvent.click(screen.getByRole('tab', { name: /Completed/ }));
    expect(await screen.findByText('No cases in this stage.')).toBeInTheDocument();
  });

  it('10. the active tab is reflected in the URL as ?tab=<STAGES label>', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    fireEvent.click(screen.getByRole('tab', { name: /Completed/ }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard?tab=Completed', { scroll: false }));
  });

  it('a bookmarked ?tab=<label> URL restores that tab on load', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    searchParams = new URLSearchParams({ tab: 'Completed' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Completed/ })).toHaveAttribute('aria-selected', 'true'));
  });

  it('an unrecognized ?tab= value falls back to All Cases rather than erroring', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    searchParams = new URLSearchParams({ tab: 'Not A Real Stage' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    await waitFor(() => expect(screen.getByRole('tab', { name: /All Cases/ })).toHaveAttribute('aria-selected', 'true'));
  });

  it("CasesByStagePanel's stage bars stay wired to the same tab-selection state: clicking a bar selects its tab, and re-clicking the selected bar toggles back to All Cases", async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    pushCase('bar-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'BAR CLICK CASE', rawStage: 7 });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('Cases by stage');

    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^Completed/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('BAR CLICK CASE')).toBeInTheDocument();
    });

    // Re-clicking the SAME (now-selected) bar toggles back to All Cases,
    // mirroring handleSelectStageFromBar's `activeTab === label ? null : label`.
    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /^All Cases/ })).toHaveAttribute('aria-selected', 'true'));
  });
});

describe('DashboardPage — pagination / Load More (Case list scalability, Phase 3)', () => {
  it('8. a Load More failure preserves the cases already loaded', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    pushCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'KEEP ME', rawStage: 7 });

    // Full control over the response shape: page 1 claims hasMore (via a
    // fake cursor) without needing 50 real fixtures to force a genuine
    // second Wix/mock page; the cursor-bearing (page 2) call always fails.
    const listPageSpy = vi.spyOn(casesService, 'listPage').mockImplementation(async (_context, filters) => {
      if (filters?.cursor) throw new Error('simulated Load More failure');
      return { cases: [caseFixtures.find((c) => c.id === 'a')!], hasMore: true, nextCursor: 'fake-cursor' };
    });

    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    fireEvent.click(screen.getByRole('tab', { name: /Completed/ }));
    await screen.findByText('KEEP ME');
    const loadMoreButton = await screen.findByRole('button', { name: 'Load More' });

    fireEvent.click(loadMoreButton);
    await waitFor(() => expect(listPageSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cursor: 'fake-cursor' }), expect.anything()));

    // The failed page-2 request never cleared the already-loaded case.
    expect(screen.getByText('KEEP ME')).toBeInTheDocument();
    listPageSpy.mockRestore();
  });
});

describe('DashboardPage — server-side search (Case list scalability, Phase 3)', () => {
  function renderPageWithSearch(organizationId: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A test-only search provider that updates `query` and `debouncedQuery`
    // TOGETHER, synchronously — no real SEARCH_DEBOUNCE_MS timer at all.
    // These integration tests are about "given a search term is active,
    // does the Dashboard do X" — not about the debounce mechanism itself
    // (which has its own dedicated unit test, hooks/useCaseSearch.test.tsx);
    // going through the real timer here only reintroduced exactly the
    // real-timer/act() flakiness this rewrite is replacing.
    function TestSearchProvider({ children }: { children: React.ReactNode }) {
      const [value, setValue] = useState('');
      return (
        <CaseSearchContext.Provider value={{ query: value, setQuery: setValue, debouncedQuery: value }}>
          {children}
        </CaseSearchContext.Provider>
      );
    }
    function SearchDriver() {
      // Mirrors TopBar.tsx's own `<SearchInput value={query} onChange={setQuery}>`
      // wiring, minimally, so a test can drive the shared search context
      // without mounting the whole (portal) layout.
      const { setQuery } = useCaseSearch();
      return <input aria-label="search-driver" onChange={(e) => setQuery(e.target.value)} />;
    }
    const result = render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider organizationId={organizationId}>
          <TestSearchProvider>
            <SearchDriver />
            <DashboardPage />
          </TestSearchProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    function search(value: string) {
      fireEvent.change(screen.getByLabelText('search-driver'), { target: { value } });
    }
    return { ...result, queryClient, search };
  }

  it('1/4. search is sent server-side — casesService.listPage receives the search query, not a client-side array filter', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    pushCase('morales-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByRole('tab', { name: /All Cases/ });

    search('morales');
    await waitFor(() => expect(listPageSpy.mock.calls.some((call) => call[1]?.searchQuery === 'morales')).toBe(true));
    listPageSpy.mockRestore();
  });

  it('2. search composes with the selected stage', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    fireEvent.click(await screen.findByRole('tab', { name: /Completed/ }));
    search('morales');

    await waitFor(() =>
      expect(listPageSpy.mock.calls.some((call) => call[1]?.stage === 'Completed' && call[1]?.searchQuery === 'morales')).toBe(true),
    );
    listPageSpy.mockRestore();
  });

  it('3. search persists when switching tabs', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    pushCase('m1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', rawStage: 0 });
    pushCase('m2', { caseNumber: 'B2026-102', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES OTHER', rawStage: 7 });
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByRole('tab', { name: /All Cases/ });
    search('morales');
    await screen.findByText('MORALES FAMILY');

    fireEvent.click(screen.getByRole('tab', { name: /Completed/ }));
    await screen.findByText('MORALES OTHER');
    // The search box's own value was never cleared by switching tabs.
    expect(screen.getByLabelText('search-driver')).toHaveValue('morales');
  });

  it('5. search results never mix with a prior unsearched page', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    pushCase('match', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
    pushCase('no-match', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', decedentName: 'SMITH FAMILY' });
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('SMITH FAMILY'); // unsearched "All Cases" shows both

    search('morales');
    // Both assertions in the SAME waitFor — "SMITH FAMILY absent" would
    // trivially (and wrongly) pass while the panel is still showing its
    // "Loading cases…" placeholder; requiring MORALES FAMILY's presence
    // too forces this to wait for the actual settled, re-fetched state.
    await waitFor(() => {
      expect(screen.queryByText('SMITH FAMILY')).not.toBeInTheDocument();
      expect(screen.getByText('MORALES FAMILY')).toBeInTheDocument();
    });
  });

  it('6. search-aware counts update when a search query is active', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    pushCase('match', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', rawStage: 7 });
    pushCase('no-match', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', decedentName: 'SMITH FAMILY', rawStage: 7 });
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    await waitFor(() => expect(screen.getByRole('tab', { name: /^All Cases/ }).textContent).toContain('2'));

    search('morales');
    await waitFor(() => expect(screen.getByRole('tab', { name: /^All Cases/ }).textContent).toContain('1'));
  });

  it('7. clearing search restores the selected tab\'s unsearched results', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    pushCase('match', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
    pushCase('no-match', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', decedentName: 'SMITH FAMILY' });
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    search('morales');
    await waitFor(() => expect(screen.queryByText('SMITH FAMILY')).not.toBeInTheDocument());

    search('');
    await waitFor(() => expect(screen.getByText('SMITH FAMILY')).toBeInTheDocument());
    expect(screen.getByText('MORALES FAMILY')).toBeInTheDocument();
  });
});

/**
 * Case list scalability, Phase 3 (2026-09). Mutation / cache invalidation
 * — every case mutation already invalidates the `['cases', organizationId]`
 * prefix (hooks/useCaseMutations.ts, useCreateCase.ts, useAdvanceCaseStage.ts);
 * the new tabbed list/counts queries nest under that exact prefix (see
 * hooks/useCaseListPage.ts/useCaseCounts.ts's own comments), so these
 * prove that existing invalidation now also refreshes the new UI, with no
 * new invalidation code of its own.
 */
describe('DashboardPage — mutation cache invalidation (Case list scalability, Phase 3)', () => {
  it('1/2/5. advancing a case to its next stage removes it from the old tab and updates both tabs\' counts', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    // rawStage 1, not 0: "First Call & Payment" combines BOTH raw stages 0
    // and 1 into one display stage (domain/cases/stages.ts) — advancing
    // from raw 0 to raw 1 would still be the SAME tab. Starting at raw 1
    // means advanceToNextStage's single `rawStage + 1` genuinely leaves
    // the tab (-> raw 2, "Jotform Application").
    pushCase('advance-me', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'ADVANCE ME', rawStage: 1 });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    fireEvent.click(await screen.findByRole('tab', { name: /First Call & Payment/ }));
    await screen.findByText('ADVANCE ME');
    await waitFor(() => expect(screen.getByRole('tab', { name: /First Call & Payment/ }).textContent).toContain('1'));

    fireEvent.click(screen.getByRole('checkbox', { name: /Select ADVANCE ME/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Advance 1 to next stage' }));

    await waitFor(() => expect(screen.queryByText('ADVANCE ME')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('tab', { name: /First Call & Payment/ }).textContent).toContain('0'));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Jotform Application/ }).textContent).toContain('1'));
  });

  it('3. a newly-created case appears in All Cases and its stage tab, and updates counts, once the standard cases cache is invalidated', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    const { queryClient } = renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await waitFor(() => expect(screen.getByRole('tab', { name: /^All Cases/ }).textContent).toContain('0'));

    pushCase('brand-new', { caseNumber: 'B2026-999', createdAt: '2026-05-01T00:00:00.000Z', decedentName: 'BRAND NEW CASE', rawStage: 0 });
    // The exact invalidation hooks/useCreateCase.ts's own onSuccess performs.
    await queryClient.invalidateQueries({ queryKey: ['cases', SECOND_MOCK_ORGANIZATION_ID] });

    await screen.findByText('BRAND NEW CASE');
    await waitFor(() => expect(screen.getByRole('tab', { name: /^All Cases/ }).textContent).toContain('1'), { timeout: 3000 });
  });
});
