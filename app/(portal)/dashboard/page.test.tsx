import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';
import * as reportsClient from '@/lib/reportsClient';
import type { DashboardResult } from '@/services/dashboardService';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { STAGES } from '@/domain/cases/stages';
import type { Case } from '@/types/case';

/**
 * Manors go-live cleanup (2026-09): the Main Dashboard's own page-level
 * test file. Mocks lib/reportsClient.ts#fetchDashboard directly (the same
 * "mock the client fetch function" pattern app/family/(portal)/dashboard/
 * page.test.tsx already established) — everything else (cases, staff,
 * organization context) uses the real mock adapter and its shared
 * fixtures, matching how the rest of this app's page-level tests already
 * run.
 *
 * Case list scalability, Phase 3 — UX correction (2026-09): this file's
 * tab/pagination/search/Load-More/mutation-invalidation coverage moved
 * to app/(portal)/cases/page.test.tsx, since that behavior now lives on
 * the dedicated case-list route, not the Dashboard. What remains here
 * proves the Dashboard stayed a fixed-height summary — Needs Attention
 * full-width, Cases by Stage below it as a pure navigation hub, and
 * critically, NO case results of any kind rendered inline.
 */
vi.mock('@/lib/reportsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reportsClient')>('@/lib/reportsClient');
  return { ...actual, fetchDashboard: vi.fn() };
});

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

/** Case list scalability, Phase 3 — UX correction (2026-09): a couple of
    tests need precise control over how many cases exist (to prove the
    Dashboard's own footprint doesn't grow with them), so they render
    against a second, dedicated organization rather than
    DEFAULT_ORGANIZATION_ID's real seed data. */
function renderPageForOrg(organizationId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={organizationId}>
        <DashboardPage />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
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
    expect(within(panel).getAllByRole('link')).toHaveLength(3);
  });
});

/**
 * Case list scalability, Phase 3 — UX correction (2026-09). Cases by
 * Stage is now a pure navigation hub into the dedicated `/cases` route —
 * these tests prove the Dashboard itself never renders case results, and
 * that Needs Attention/Cases by Stage are laid out full-width/stacked
 * rather than sharing the old two-column grid.
 */
describe('DashboardPage — Cases by Stage is a navigation hub, not a case list (Case list scalability, Phase 3 — UX correction)', () => {
  it('1. Needs Attention appears before Cases by Stage, in document order (full-width, stacked layout)', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();

    const needsAttentionHeading = await screen.findByText('Needs attention');
    const casesByStageHeading = await screen.findByText('Cases by stage');
    expect(needsAttentionHeading.compareDocumentPosition(casesByStageHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('2/3. Cases by Stage contains an "All Cases" navigation link to /cases (no stage filter)', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();

    const allCasesLink = await screen.findByRole('link', { name: /All Cases/ });
    expect(allCasesLink).toHaveAttribute('href', '/cases');
  });

  it('4. every canonical stage remains present as a navigation link, filtering the /cases route to that stage', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();

    for (const label of STAGES) {
      const link = await screen.findByRole('link', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
      const url = new URL(link.getAttribute('href')!, 'http://localhost');
      expect(url.pathname).toBe('/cases');
      expect(url.searchParams.get('stage')).toBe(label);
    }
  });

  it('5. renders stage counts from the server-side counts endpoint, not a client-side aggregation', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    for (let i = 0; i < 3; i++) {
      pushCase(`c-${i}`, { caseNumber: `B2026-${100 + i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z`, rawStage: 7 });
    }
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    const completedLink = await screen.findByRole('link', { name: /^Completed/ });
    await waitFor(() => expect(completedLink.textContent).toContain('3'));
  });

  it('6. 5/6/7. the Dashboard never renders individual case rows or cards, regardless of how many cases exist', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    for (let i = 0; i < 10; i++) {
      pushCase(`bulk-${i}`, {
        caseNumber: `B2026-${200 + i}`,
        createdAt: `2026-02-0${(i % 9) + 1}T00:00:00.000Z`,
        decedentName: `BULK DECEDENT ${i}`,
        rawStage: (i % 7) + 1,
        isStalled: false,
      });
    }
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    await screen.findByText('Cases by stage');
    // None of the pushed decedents' names ever appear anywhere on the
    // Dashboard — there is no case list/card UI left to render them.
    for (let i = 0; i < 10; i++) {
      expect(screen.queryByText(`BULK DECEDENT ${i}`)).not.toBeInTheDocument();
    }
    // No "Load More" control either — that belongs exclusively to the
    // dedicated case-list route's pagination, never the Dashboard.
    expect(screen.queryByRole('button', { name: 'Load More' })).not.toBeInTheDocument();
  });

  it('8. Financial Summary and the rest of the Dashboard remain in the normal page flow, reachable without scrolling past any case list', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue({
      ...BASE_DASHBOARD,
      financial: { grossRevenue: 100, cashCollected: 100, accountsReceivableTotal: 0 },
    });
    renderPage();

    await screen.findByText('Cases by stage');
    expect(await screen.findByText('Financial summary')).toBeInTheDocument();
  });
});
