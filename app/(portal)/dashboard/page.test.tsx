import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';
import * as reportsClient from '@/lib/reportsClient';
import type { DashboardResult } from '@/services/dashboardService';

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

afterEach(() => {
  vi.clearAllMocks();
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
