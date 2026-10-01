import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CasesPage from './page';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { CaseSearchContext, useCaseSearch } from '@/hooks/useCaseSearch';
import { casesService } from '@/services/casesService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { STAGES } from '@/domain/cases/stages';
import type { Case } from '@/types/case';

/**
 * Case list scalability, Phase 3 — UX correction (2026-09). The dedicated
 * case-list route — this file carries the pagination/search/Load-More/
 * mutation-invalidation coverage that previously lived on the Dashboard's
 * own tabbed list (app/(portal)/dashboard/page.test.tsx), now that the
 * actual case results render here instead. The active stage filter comes
 * from `?stage=<STAGES label>` on THIS route (never a Dashboard-owned
 * tab), mocked the same way app/family/login/page.test.tsx already mocks
 * `next/navigation` for a client-component page reading `useSearchParams`.
 */
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

function renderPageForOrg(organizationId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={organizationId}>
        <CasesPage />
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
    isStalled: false,
    ...overrides,
    id,
    organizationId: SECOND_MOCK_ORGANIZATION_ID,
    isDeleted: overrides.isDeleted ?? false,
  });
  pushedIds.push(id);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  searchParams = new URLSearchParams();
  while (pushedIds.length > 0) {
    const id = pushedIds.pop()!;
    const index = caseFixtures.findIndex((c) => c.id === id);
    if (index !== -1) caseFixtures.splice(index, 1);
  }
});

describe('CasesPage — heading / navigation context', () => {
  it('1. with no ?stage=, shows the "All Cases" heading and requests an unfiltered bounded first page', async () => {
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    expect(await screen.findByText('All Cases')).toBeInTheDocument();
    await waitFor(() => expect(listPageSpy).toHaveBeenCalled());
    expect(listPageSpy.mock.calls.every((call) => call[1]?.stage === null)).toBe(true);
    listPageSpy.mockRestore();
  });

  it('2/3. ?stage=<label> shows that stage as the heading and requests only that stage, server-side', async () => {
    searchParams = new URLSearchParams({ stage: 'Completed' });
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    await waitFor(() => expect(listPageSpy.mock.calls.some((call) => call[1]?.stage === 'Completed')).toBe(true));
    listPageSpy.mockRestore();
  });

  it('4. an unrecognized ?stage= value falls back to All Cases rather than erroring', async () => {
    searchParams = new URLSearchParams({ stage: 'Not A Real Stage' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    expect(await screen.findByText('All Cases')).toBeInTheDocument();
  });

  it('has a "Back to Dashboard" link preserving the existing navigation convention', async () => {
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    const link = await screen.findByRole('link', { name: /Back to Dashboard/ });
    expect(link).toHaveAttribute('href', '/dashboard');
  });
});

describe('CasesPage — pagination (Case list scalability, Phase 3)', () => {
  it('1. All Cases requests a bounded first page (no stage param)', async () => {
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await waitFor(() => expect(listPageSpy).toHaveBeenCalled());
    expect(listPageSpy.mock.calls[0][1]).toMatchObject({ stage: null, cursor: null });
    listPageSpy.mockRestore();
  });

  it('2. a stage view requests a bounded, stage-filtered first page', async () => {
    searchParams = new URLSearchParams({ stage: 'EDRS & Doctor / Cause of Death' });
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await waitFor(() => expect(listPageSpy).toHaveBeenCalled());
    expect(listPageSpy.mock.calls[0][1]).toMatchObject({ stage: 'EDRS & Doctor / Cause of Death', cursor: null });
    listPageSpy.mockRestore();
  });

  it('3. Load More sends nextCursor, preserves the stage, and appends (never replaces) results', async () => {
    pushCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'PAGE ONE CASE', rawStage: 7 });
    pushCase('b', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', decedentName: 'PAGE TWO CASE', rawStage: 7 });

    const listPageSpy = vi.spyOn(casesService, 'listPage').mockImplementation(async (_context, filters) => {
      if (filters?.cursor) {
        return { cases: [caseFixtures.find((c) => c.id === 'b')!], hasMore: false, nextCursor: null };
      }
      return { cases: [caseFixtures.find((c) => c.id === 'a')!], hasMore: true, nextCursor: 'fake-cursor' };
    });

    searchParams = new URLSearchParams({ stage: 'Completed' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('PAGE ONE CASE');
    const loadMoreButton = await screen.findByRole('button', { name: 'Load More' });

    fireEvent.click(loadMoreButton);
    await waitFor(() =>
      expect(listPageSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cursor: 'fake-cursor', stage: 'Completed' }),
        expect.anything(),
      ),
    );
    // Page 1's case is still there (appended to, not replaced by, page 2)
    // and page 2's case now also appears — each exactly once.
    await waitFor(() => expect(screen.getByText('PAGE TWO CASE')).toBeInTheDocument());
    expect(screen.getAllByText('PAGE ONE CASE')).toHaveLength(1);
    expect(screen.getAllByText('PAGE TWO CASE')).toHaveLength(1);
    listPageSpy.mockRestore();
  });

  it('7. Completed never preloads the full historical collection — only the first bounded page on load', async () => {
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    searchParams = new URLSearchParams({ stage: 'Completed' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await waitFor(() => expect(listPageSpy).toHaveBeenCalled());

    expect(listPageSpy).toHaveBeenCalledTimes(1);
    expect(listPageSpy.mock.calls[0][1]?.cursor).toBeNull();
    listPageSpy.mockRestore();
  });

  it('8. an empty stage renders "No cases in this stage."', async () => {
    searchParams = new URLSearchParams({ stage: 'Completed' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    expect(await screen.findByText('No cases in this stage.')).toBeInTheDocument();
  });

  it('9. an initial-load failure shows a retry-capable error state without crashing the page', async () => {
    const listPageSpy = vi.spyOn(casesService, 'listPage').mockRejectedValue(new Error('simulated failure'));
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    expect(await screen.findByText('Unable to load cases right now.')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Retry' });
    listPageSpy.mockResolvedValue({ cases: [], hasMore: false, nextCursor: null });
    fireEvent.click(retryButton);
    await waitFor(() => expect(screen.queryByText('Unable to load cases right now.')).not.toBeInTheDocument());
  });

  it('10. a Load More failure preserves the cases already loaded', async () => {
    pushCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'KEEP ME', rawStage: 7 });
    const listPageSpy = vi.spyOn(casesService, 'listPage').mockImplementation(async (_context, filters) => {
      if (filters?.cursor) throw new Error('simulated Load More failure');
      return { cases: [caseFixtures.find((c) => c.id === 'a')!], hasMore: true, nextCursor: 'fake-cursor' };
    });

    searchParams = new URLSearchParams({ stage: 'Completed' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('KEEP ME');
    const loadMoreButton = await screen.findByRole('button', { name: 'Load More' });

    fireEvent.click(loadMoreButton);
    await waitFor(() => expect(listPageSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cursor: 'fake-cursor' }), expect.anything()));

    expect(screen.getByText('KEEP ME')).toBeInTheDocument();
    listPageSpy.mockRestore();
  });
});

describe('CasesPage — server-side search (Case list scalability, Phase 3)', () => {
  function renderPageWithSearch(organizationId: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function TestSearchProvider({ children }: { children: React.ReactNode }) {
      const [value, setValue] = useState('');
      return (
        <CaseSearchContext.Provider value={{ query: value, setQuery: setValue, debouncedQuery: value }}>
          {children}
        </CaseSearchContext.Provider>
      );
    }
    function SearchDriver() {
      const { setQuery } = useCaseSearch();
      return <input aria-label="search-driver" onChange={(e) => setQuery(e.target.value)} />;
    }
    const result = render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider organizationId={organizationId}>
          <TestSearchProvider>
            <SearchDriver />
            <CasesPage />
          </TestSearchProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    function search(value: string) {
      fireEvent.change(screen.getByLabelText('search-driver'), { target: { value } });
    }
    return { ...result, queryClient, search };
  }

  it('4. search is sent server-side — casesService.listPage receives the search query, not a client-side array filter', async () => {
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    pushCase('morales-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('All Cases');

    search('morales');
    await waitFor(() => expect(listPageSpy.mock.calls.some((call) => call[1]?.searchQuery === 'morales')).toBe(true));
    listPageSpy.mockRestore();
  });

  it('5. search composes with the selected stage', async () => {
    searchParams = new URLSearchParams({ stage: 'Completed' });
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('Completed');
    search('morales');

    await waitFor(() =>
      expect(listPageSpy.mock.calls.some((call) => call[1]?.stage === 'Completed' && call[1]?.searchQuery === 'morales')).toBe(true),
    );
    listPageSpy.mockRestore();
  });

  it('search results never mix with a prior unsearched page', async () => {
    pushCase('match', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
    pushCase('no-match', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', decedentName: 'SMITH FAMILY' });
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('SMITH FAMILY');

    search('morales');
    await waitFor(() => {
      expect(screen.queryByText('SMITH FAMILY')).not.toBeInTheDocument();
      expect(screen.getByText('MORALES FAMILY')).toBeInTheDocument();
    });
  });

  it('clearing search restores the unsearched results', async () => {
    pushCase('match', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
    pushCase('no-match', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', decedentName: 'SMITH FAMILY' });
    const { search } = renderPageWithSearch(SECOND_MOCK_ORGANIZATION_ID);
    search('morales');
    await waitFor(() => expect(screen.queryByText('SMITH FAMILY')).not.toBeInTheDocument());

    search('');
    await waitFor(() => expect(screen.getByText('SMITH FAMILY')).toBeInTheDocument());
    expect(screen.getByText('MORALES FAMILY')).toBeInTheDocument();
  });

  it('6. All Cases results expose each case\'s current stage', async () => {
    pushCase('x', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'STAGE VISIBLE CASE', rawStage: 7 });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    const row = (await screen.findByText('STAGE VISIBLE CASE')).closest('a')!;
    // A stage badge is rendered alongside the case (AllCasesList's
    // existing per-row stageLabel Badge) — the one canonical label it
    // shows depends on the mock fixture's own workflowSnapshot, not
    // asserted exactly here; what matters is that a stage is visible at
    // all on an unfiltered (All Cases) result row.
    const hasStageBadge = STAGES.some((label) => row.textContent?.includes(label));
    expect(hasStageBadge).toBe(true);
  });
});

describe('CasesPage — mutation cache invalidation (Case list scalability, Phase 3)', () => {
  it('1/2. advancing a case to its next stage removes it from the current stage-filtered list', async () => {
    pushCase('advance-me', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'ADVANCE ME', rawStage: 1 });
    searchParams = new URLSearchParams({ stage: 'First Call & Payment' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    await screen.findByText('ADVANCE ME');
    fireEvent.click(screen.getByRole('checkbox', { name: /Select ADVANCE ME/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Advance 1 to next stage' }));

    await waitFor(() => expect(screen.queryByText('ADVANCE ME')).not.toBeInTheDocument());
  });

  it('3. a newly-created case appears in All Cases once the standard cases cache is invalidated', async () => {
    const { queryClient } = renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('No cases yet.');

    pushCase('brand-new', { caseNumber: 'B2026-999', createdAt: '2026-05-01T00:00:00.000Z', decedentName: 'BRAND NEW CASE', rawStage: 0 });
    await queryClient.invalidateQueries({ queryKey: ['cases', SECOND_MOCK_ORGANIZATION_ID] });

    await screen.findByText('BRAND NEW CASE');
  });
});

/**
 * Case list scalability, Phase 3 — progress indicator (2026-09).
 */
describe('CasesPage — case progress indicator (Case list scalability, Phase 3)', () => {
  it('11. All Cases shows progress for every case on a bounded page without any N+1 per-case request pattern', async () => {
    for (let i = 0; i < 5; i++) {
      pushCase(`p-${i}`, { caseNumber: `B2026-${100 + i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z`, decedentName: `PROGRESS CASE ${i}`, rawStage: 3 });
    }
    const listPageSpy = vi.spyOn(casesService, 'listPage');
    const getSpy = vi.spyOn(casesService, 'get');
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    await screen.findByText('PROGRESS CASE 0');
    // Every pushed case got its own progress bar...
    expect(screen.getAllByRole('progressbar')).toHaveLength(5);
    // ...but the list was fetched in exactly ONE request, never one per
    // case — progress comes from the same Case records the list request
    // already returns (each one's workflowSnapshot), not a second
    // per-case round trip.
    expect(listPageSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).not.toHaveBeenCalled();
    listPageSpy.mockRestore();
    getSpy.mockRestore();
  });

  it('13. completing a checklist item and invalidating the cache refreshes the displayed progress, without a full page refresh', async () => {
    pushCase('checklist-case', {
      caseNumber: 'B2026-101',
      createdAt: '2026-01-01T00:00:00.000Z',
      decedentName: 'CHECKLIST CASE',
      rawStage: 3,
      checklistState: { 0: true, 1: false, 2: false },
    });
    const { queryClient } = renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('CHECKLIST CASE');
    const before = Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'));

    const organization = { organizationId: SECOND_MOCK_ORGANIZATION_ID, dataAdapterMode: 'mock' as const };
    await casesService.update(organization, 'checklist-case', { checklistState: { 0: true, 1: true, 2: false } });
    await queryClient.invalidateQueries({ queryKey: ['cases', SECOND_MOCK_ORGANIZATION_ID] });

    await waitFor(() => {
      const after = Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'));
      expect(after).toBeGreaterThan(before);
    });
  });

  it('12. a stage-filtered list shows the same progress as the All Cases view for the same case', async () => {
    pushCase('same-case', {
      caseNumber: 'B2026-101',
      createdAt: '2026-01-01T00:00:00.000Z',
      decedentName: 'SAME CASE EVERYWHERE',
      rawStage: 3,
      checklistState: { 0: true, 1: false, 2: false },
    });
    const allCasesRender = renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('SAME CASE EVERYWHERE');
    const allCasesPercent = screen.getByRole('progressbar').getAttribute('aria-valuenow');
    allCasesRender.unmount();

    searchParams = new URLSearchParams({ stage: 'EDRS & Doctor / Cause of Death' });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);
    await screen.findByText('SAME CASE EVERYWHERE');
    const stageFilteredPercent = screen.getByRole('progressbar').getAttribute('aria-valuenow');

    expect(stageFilteredPercent).toBe(allCasesPercent);
  });
});
