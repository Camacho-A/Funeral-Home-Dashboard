import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';
import * as reportsClient from '@/lib/reportsClient';
import type { DashboardResult } from '@/services/dashboardService';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { STAGES } from '@/domain/cases/stages';
import { presentedStageLabels } from '@/domain/organization/workflowStagePresentation';
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
 * SOLIS true redesign, Phase 1 (2026-10): rewritten for the new
 * composition (a KPI strip + a two-column briefing layout, replacing the
 * prior side-by-side Needs-Attention/Cases-by-Stage grid and the
 * separate full-width Financial Summary section) and for Cases by
 * Stage's new Stage Preview accordion. What this file still proves is
 * unchanged in substance: the Dashboard stays a fixed-height summary — no
 * case results render inline until a stage is explicitly expanded, Cases
 * by Stage's own counts/links are unchanged navigation, and Financial
 * Summary's figures (now cells in the KPI strip) are unchanged, correctly
 * formatted, and correctly gated by permission/loading/error state.
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

describe('DashboardPage — KPI strip (SOLIS true redesign, Phase 1)', () => {
  it('renders the real financial figures, correctly comma-formatted (fixes the pre-existing no-thousands-separator bug)', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue({
      ...BASE_DASHBOARD,
      financial: { grossRevenue: 500000, cashCollected: 350000, accountsReceivableTotal: 150000 },
    });
    renderPage();

    expect(await screen.findByText('$5,000.00')).toBeInTheDocument();
    expect(screen.getByText('$3,500.00')).toBeInTheDocument();
    expect(screen.getByText('$1,500.00')).toBeInTheDocument();
  });

  it('shows no financial cells, and no error notice, while a role without financial access is viewing (financial: null)', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();

    // "Active cases" renders immediately, before the mocked dashboard
    // promise resolves — wait for the financial cells to actually settle
    // (absent, once `financial` resolves to null) rather than asserting
    // their absence mid-flight, while the KPI strip is still in its
    // loading placeholder state.
    await waitFor(() => expect(screen.queryByText('Gross revenue')).not.toBeInTheDocument());
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Unable to load the financial summary right now.')).not.toBeInTheDocument();
  });

  it('shows a quiet inline notice, not a missing section with no explanation, if the dashboard query fails', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText('Unable to load the financial summary right now.')).toBeInTheDocument();
  });

  it('always shows Active cases and Needs attention, regardless of financial access', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();
    expect(await screen.findByText('Active cases')).toBeInTheDocument();
    // "Needs attention" legitimately appears twice — once as the KPI
    // strip's own cell label, once as the Needs Attention panel's
    // heading — both per the approved design.
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThanOrEqual(2);
  });
});

describe('DashboardPage — Needs Attention remains present (Manors go-live cleanup, 2026-09)', () => {
  it('the "Needs attention" panel remains present regardless of financial/attention section state', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue({
      ...BASE_DASHBOARD,
      attention: { overdueCases: 3, overdueTasks: 2, outstandingSignatures: 1, failedPayments: 1 },
    });
    renderPage();

    expect(await screen.findByText('All caught up')).toBeInTheDocument();
    // The lower, org-wide "Attention" card (a distinct, unrelated concept —
    // see dashboardService.ts's own DashboardAttentionSection) was removed
    // from this page well before this phase and stays removed.
    expect(screen.queryByText('Overdue tasks')).not.toBeInTheDocument();
    expect(screen.queryByText('Outstanding signatures')).not.toBeInTheDocument();
  });
});

describe('DashboardPage — Cases by Stage is a navigation hub with a Stage Preview accordion (SOLIS true redesign, Phase 1)', () => {
  it('Needs Attention and Cases by Stage render in the two-column briefing layout, Needs Attention first in DOM order', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();

    // "Needs attention" legitimately appears twice (the KPI strip's own
    // cell label, and the panel's own heading, which carries the
    // `.title` class the KPI strip's `.label` cell does not) — the panel
    // heading is the one this test cares about.
    await screen.findByText('Active cases');
    const needsAttentionHeading = screen.getAllByText('Needs attention').find((el) => el.className.includes('title'))!;
    const casesByStageHeading = await screen.findByText('Cases by stage');
    expect(needsAttentionHeading.compareDocumentPosition(casesByStageHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('contains an "All cases" navigation link to /cases (no stage filter)', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();

    const allCasesLink = await screen.findByRole('link', { name: /All cases/ });
    expect(allCasesLink).toHaveAttribute('href', '/cases');
  });

  it('every user-facing stage is present as a collapsed toggle button', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();

    // Manors intake-stage combination (2026-10): Cases by Stage shows the
    // six USER-FACING stages, so the two historical intake stages appear
    // as one "Intake & JotForm" row rather than two.
    const presented = presentedStageLabels(DEFAULT_ORGANIZATION_ID, STAGES);
    expect(presented).toHaveLength(6);
    expect(presented[0]).toBe('Intake & JotForm');

    for (const label of presented) {
      const button = await screen.findByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
      expect(button).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('does not show First Call & Payment or Jotform Application as separate stage rows', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    renderPage();
    await screen.findByRole('button', { name: /^Intake & JotForm/ });

    expect(screen.queryByRole('button', { name: /^First Call & Payment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Jotform Application/ })).not.toBeInTheDocument();
  });

  it('renders stage counts from the server-side counts endpoint, not a client-side aggregation', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    for (let i = 0; i < 3; i++) {
      pushCase(`c-${i}`, { caseNumber: `B2026-${100 + i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z`, rawStage: 7 });
    }
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    const completedButton = await screen.findByRole('button', { name: /^Completed/ });
    await waitFor(() => expect(completedButton.textContent).toContain('3'));
  });

  it('never renders individual case rows or cards while every stage is collapsed, regardless of how many cases exist', async () => {
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
    for (let i = 0; i < 10; i++) {
      expect(screen.queryByText(`BULK DECEDENT ${i}`)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Load More' })).not.toBeInTheDocument();
  });

  it('clicking a stage with real cases expands its Stage Preview, showing those cases by name — the one approved Dashboard interaction change', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
    // rawStage 3 -> displayStage 2 ("EDRS & Doctor / Cause of Death") — a
    // non-terminal stage, so CaseViewModel's own effective-stage rollback
    // (for the terminal return-of-remains requirement, see
    // domain/cases/transitions.ts) can never apply and shift this case to
    // a different displayed stage than its raw stage would suggest.
    pushCase('preview-1', { caseNumber: 'B2026-900', createdAt: '2026-03-01T00:00:00.000Z', decedentName: 'PREVIEW DECEDENT', rawStage: 3 });
    renderPageForOrg(SECOND_MOCK_ORGANIZATION_ID);

    const stageButton = await screen.findByRole('button', { name: /^EDRS & Doctor \/ Cause of Death/ });
    fireEvent.click(stageButton);

    expect(stageButton).toHaveAttribute('aria-expanded', 'true');
    // Visual fidelity correction (2026-10): the Stage Preview applies the
    // same presentation-only title-case helper the approved design's
    // typography rules call for (utils/string.ts#toDisplayTitleCase) —
    // the stored decedentName ("PREVIEW DECEDENT") is never rewritten,
    // only rendered differently.
    expect(await screen.findByText('Preview Decedent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Preview Decedent/ })).toHaveAttribute('href', '/cases/preview-1');
  });

  it('Financial Summary cells and the rest of the Dashboard remain in the normal page flow, reachable without scrolling past any case list', async () => {
    vi.mocked(reportsClient.fetchDashboard).mockResolvedValue({
      ...BASE_DASHBOARD,
      financial: { grossRevenue: 100, cashCollected: 100, accountsReceivableTotal: 0 },
    });
    renderPage();

    await screen.findByText('Cases by stage');
    expect(await screen.findByText('Gross revenue')).toBeInTheDocument();
  });
});
