'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCases } from '@/hooks/useCases';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import { useAdvanceCaseStage } from '@/hooks/useAdvanceCaseStage';
import { useCaseListPage } from '@/hooks/useCaseListPage';
import { useCaseCounts } from '@/hooks/useCaseCounts';
import { STAGES } from '@/domain/cases/stages';
import { computeKpis, groupCasesByDisplayStage } from '@/domain/reports/calculations';
import { useOrganization } from '@/hooks/useOrganization';
import { useDashboardData } from '@/hooks/useDashboard';
import { PageGreetingHeader } from '@/components/dashboard/PageGreetingHeader';
import { NeedsAttentionPanel } from '@/components/dashboard/NeedsAttentionPanel';
import { CasesByStagePanel } from '@/components/dashboard/CasesByStagePanel';
import { CaseListTabs, type CaseListTabDef } from '@/components/dashboard/CaseListTabs';
import { AllCasesList } from '@/components/dashboard/AllCasesList';
import { StageFilteredPanel } from '@/components/dashboard/StageFilteredPanel';
import { RecentActivityPanel } from '@/components/dashboard/RecentActivityPanel';
import { FinancialSummaryPanel } from '@/components/dashboard/FinancialSummaryPanel';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './page.module.css';

const CASE_LIST_PANEL_ID = 'case-list-panel';

/** "All Cases" (`null`) + the 7 canonical STAGES, in that fixed order —
    built once from the canonical array (Case list scalability, Phase 3),
    never a second, hand-typed list of stage names. */
const TAB_DEFS: { key: string | null; label: string }[] = [
  { key: null, label: 'All Cases' },
  ...STAGES.map((label) => ({ key: label, label })),
];

function isValidStageTab(value: string | null): value is (typeof STAGES)[number] {
  return value !== null && (STAGES as readonly string[]).includes(value);
}

/**
 * Case list scalability, Phase 3 (2026-09). The 8-tab case list — see
 * CaseListTabs.tsx, hooks/useCaseListPage.ts, hooks/useCaseCounts.ts for
 * the supporting architecture. Replaces the old vertical
 * AllCasesList/StageFilteredPanel toggle (driven by a numeric
 * `stageFilter` + the full-dataset `useCases()` fetch) with tabs driven
 * by a bounded, server-paginated query per tab — only the ACTIVE tab's
 * data is ever requested.
 *
 * `useCases()` (the legacy, complete-result fetch) is deliberately NOT
 * removed — NeedsAttentionPanel, the KPI header's active-case count, and
 * CasesByStagePanel's own bar-chart breakdown are unrelated to this
 * phase's scope and still depend on having every case's ViewModel in
 * memory to compute "needs attention"/stage-breakdown bars client-side.
 * See this phase's own report for why that's an accepted, explicitly
 * reported remaining legacy-fetch-all consumer rather than something
 * silently left in place.
 */
function DashboardPageContent() {
  const { organizationId } = useOrganization();
  const { data: dashboardData, isLoading: isDashboardLoading, isError: isDashboardError } = useDashboardData(organizationId);
  const { debouncedQuery } = useCaseSearch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL/navigation state (Case list scalability, Phase 3): the active tab
  // is reflected as `?tab=<STAGES label>` — the exact same stable
  // identifier GET /api/cases's own `stage` param already uses, never a
  // second, Dashboard-only id scheme. Omitted entirely for "All Cases"
  // (the default), so the plain `/dashboard` URL is still the common
  // case. An unrecognized/stale `tab` value (e.g. a bookmarked URL from
  // before a stage was renamed) falls back to All Cases rather than
  // erroring.
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTabState] = useState<string | null>(() => (isValidStageTab(tabParam) ? tabParam : null));
  const [selectedCaseIds, setSelectedCaseIds] = useState<Record<string, boolean>>({});
  const [todayLabel, setTodayLabel] = useState('');

  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    );
  }, []);

  function setActiveTab(tab: string | null) {
    setActiveTabState(tab);
    setSelectedCaseIds({});
    const params = new URLSearchParams(searchParams.toString());
    if (tab) params.set('tab', tab);
    else params.delete('tab');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Search query changes reset pagination implicitly: it's part of
  // useCaseListPage's own query key, so a new searchQuery is simply a
  // different cached query starting at page 1 — but bulk-selection is
  // page-content-dependent UI state this component owns, so it's reset
  // explicitly here rather than silently pointing at rows that may no
  // longer be visible.
  useEffect(() => {
    setSelectedCaseIds({});
  }, [debouncedQuery]);

  // Legacy, complete-result fetch (Case list scalability, Phase 1/2's
  // documented "transitional" path) — kept ONLY for the three unrelated
  // features below; the tabbed case list itself never reads from this.
  const { data: allCases } = useCases();
  const allViewModels = useCaseViewModels(allCases);
  const advanceStage = useAdvanceCaseStage();

  const kpis = useMemo(() => computeKpis(allViewModels), [allViewModels]);
  const urgentCases = useMemo(() => allViewModels.filter((c) => c.needsAttention), [allViewModels]);
  const stageBreakdownRows = useMemo(() => {
    const counts = groupCasesByDisplayStage(allViewModels).map((group) => group.length);
    const maxCount = Math.max(1, ...counts);
    return STAGES.map((label, index) => ({
      label,
      count: counts[index],
      pct: Math.round((counts[index] / maxCount) * 100),
      selected: activeTab === label,
    }));
  }, [allViewModels, activeTab]);

  // The actual tabbed case list — bounded, server-paginated, scoped to
  // the active tab + debounced search term only.
  const listQuery = useCaseListPage({ stage: activeTab, searchQuery: debouncedQuery });
  const flatCases = useMemo(() => listQuery.data?.pages.flatMap((page) => page.cases) ?? [], [listQuery.data]);
  const listViewModels = useCaseViewModels(flatCases);

  const { data: countsData } = useCaseCounts({ searchQuery: debouncedQuery });
  const tabs: CaseListTabDef[] = useMemo(
    () =>
      TAB_DEFS.map((tab) => ({
        key: tab.key,
        label: tab.label,
        count: !countsData ? null : tab.key === null ? countsData.total : countsData.byStage[tab.key] ?? 0,
      })),
    [countsData],
  );

  const emptyMessage = debouncedQuery.trim() !== '' ? 'No cases found.' : activeTab !== null ? 'No cases in this stage.' : 'No cases yet.';

  const selectedCount = Object.values(selectedCaseIds).filter(Boolean).length;

  function handleSelectStageFromBar(index: number) {
    const label = STAGES[index];
    setActiveTab(activeTab === label ? null : label);
  }

  function handleToggleSelect(caseId: string) {
    setSelectedCaseIds((current) => ({ ...current, [caseId]: !current[caseId] }));
  }

  function handleAdvance() {
    const selected = flatCases.filter((c) => selectedCaseIds[c.id]);
    advanceStage.mutate(selected, {
      onSuccess: () => setSelectedCaseIds({}),
    });
  }

  return (
    <div>
      <PageGreetingHeader todayLabel={todayLabel} activeCount={kpis.activeCases} />

      <div className={styles.stageOverviewGrid}>
        <NeedsAttentionPanel cases={urgentCases} />
        <CasesByStagePanel rows={stageBreakdownRows} onSelectStage={handleSelectStageFromBar} />
      </div>

      <CaseListTabs tabs={tabs} activeTab={activeTab} onSelectTab={setActiveTab} panelId={CASE_LIST_PANEL_ID} />

      <div
        id={CASE_LIST_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`case-list-tab-${activeTab ?? '__all__'}`}
      >
        {listQuery.isLoading && <EmptyState message="Loading cases…" />}

        {/* A failed Load More (fetchNextPage) must never replace the
            already-loaded page — gated on `!listQuery.data` specifically,
            not just `isError`, since React Query marks the query `isError`
            for a failed fetchNextPage too, even though `data` (page 1)
            is still fully intact. Only an initial-load failure (no data
            at all yet) shows this full-panel error/retry state. */}
        {!listQuery.isLoading && listQuery.isError && !listQuery.data && (
          <div className={styles.listErrorState}>
            <EmptyState message="Unable to load cases right now." />
            <Button variant="secondary" onClick={() => listQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {!listQuery.isLoading && listQuery.data && activeTab === null && (
          <AllCasesList
            cases={listViewModels}
            emptyMessage={emptyMessage}
            hasMore={Boolean(listQuery.hasNextPage)}
            isLoadingMore={listQuery.isFetchingNextPage}
            onLoadMore={() => { listQuery.fetchNextPage().catch(() => {}); }}
          />
        )}

        {!listQuery.isLoading && listQuery.data && activeTab !== null && (
          <StageFilteredPanel
            cases={listViewModels.map((c) => ({ ...c, selected: Boolean(selectedCaseIds[c.id]) }))}
            emptyMessage={emptyMessage}
            selectedCount={selectedCount}
            onToggleSelect={handleToggleSelect}
            onAdvance={handleAdvance}
            hasMore={Boolean(listQuery.hasNextPage)}
            isLoadingMore={listQuery.isFetchingNextPage}
            onLoadMore={() => { listQuery.fetchNextPage().catch(() => {}); }}
          />
        )}
      </div>

      {/* Manors go-live cleanup (2026-09): the dashboard's own "Attention"
          section (org-wide overdue cases/tasks/signatures/failed payments —
          services/dashboardService.ts's DashboardAttentionSection) was
          removed from this page for feeling redundant next to
          NeedsAttentionPanel above (per-case, Case.isStalled-driven) — a
          purely presentational call, not a claim the two concepts are the
          same. AttentionPanel/dashboardData.attention/getDashboard's
          attention computation are all untouched and still reachable via
          the /api/dashboard response; nothing here deletes that logic.
          Financial Summary now gets the freed row to itself, full width,
          with an explicit loading/error placeholder so a role that DOES
          have financial visibility never sees a bare gap while the
          dashboard query is in flight — a role that lacks it (financial
          resolves to null, never an error) sees nothing at all, exactly as
          before. */}
      {(isDashboardLoading || isDashboardError || dashboardData?.financial) && (
        <div className={styles.financialSummarySection}>
          {isDashboardLoading && <EmptyState message="Loading financial summary…" />}
          {!isDashboardLoading && isDashboardError && (
            <EmptyState message="Unable to load the financial summary right now." />
          )}
          {!isDashboardLoading && !isDashboardError && dashboardData?.financial && (
            <FinancialSummaryPanel data={dashboardData.financial} />
          )}
        </div>
      )}

      <RecentActivityPanel />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<EmptyState message="Loading…" />}>
      <DashboardPageContent />
    </Suspense>
  );
}
