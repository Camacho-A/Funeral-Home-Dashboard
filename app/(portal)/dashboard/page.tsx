'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCases } from '@/hooks/useCases';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { useCaseCounts } from '@/hooks/useCaseCounts';
import { STAGES } from '@/domain/cases/stages';
import { computeKpis } from '@/domain/reports/calculations';
import { useOrganization } from '@/hooks/useOrganization';
import { useDashboardData } from '@/hooks/useDashboard';
import { PageGreetingHeader } from '@/components/dashboard/PageGreetingHeader';
import { NeedsAttentionPanel } from '@/components/dashboard/NeedsAttentionPanel';
import { CasesByStagePanel, type StageBarRow } from '@/components/dashboard/CasesByStagePanel';
import { RecentActivityPanel } from '@/components/dashboard/RecentActivityPanel';
import { FinancialSummaryPanel } from '@/components/dashboard/FinancialSummaryPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './page.module.css';

/**
 * Case list scalability, Phase 3 — UX correction (2026-09). The Dashboard
 * is a fixed-height SUMMARY/command center: its height must never grow
 * with the organization's case count. The prior iteration of this phase
 * rendered an 8-tab bar plus a full, paginated case list directly on this
 * page — that direction was explicitly reversed.
 *
 * Needs Attention and Cases by Stage sit side by side in one 1.3fr/1fr
 * grid row (styles.stageOverviewGrid), collapsing to a single stacked
 * column under 860px — see that class's own comment for the exact
 * layout correction history. Cases by Stage (components/dashboard/
 * CasesByStagePanel.tsx) is a pure NAVIGATION HUB regardless of column
 * layout — "All Cases" plus each of the 7 canonical stages are links
 * into the dedicated case-list route (`/cases`, optionally
 * `?stage=<STAGES label>`; see app/(portal)/cases/page.tsx), not a local
 * filter that renders results here. No case card, AllCasesList, or
 * StageFilteredPanel renders on this page at all — Financial Summary and
 * everything below it stays exactly as reachable as before, regardless
 * of whether the org has 20 cases or 20,000.
 *
 * Stage/All-Cases counts come from the Phase 2 counts endpoint
 * (useCaseCounts) — never a client-side aggregation over a fully-
 * downloaded case list (the prior `groupCasesByDisplayStage(allViewModels)`
 * approach). `useCases()` (the legacy, complete-result fetch) is still
 * used for NeedsAttentionPanel and the KPI header's active-case count —
 * both genuinely need every case's ViewModel client-side today and are
 * unrelated to this phase's scope; see this phase's own report for why
 * that's an accepted, explicitly reported remaining legacy-fetch-all
 * consumer rather than something silently left in place.
 */
export default function DashboardPage() {
  const { organizationId } = useOrganization();
  const { data: dashboardData, isLoading: isDashboardLoading, isError: isDashboardError } = useDashboardData(organizationId);
  const [todayLabel, setTodayLabel] = useState('');

  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    );
  }, []);

  // Legacy, complete-result fetch — kept ONLY for NeedsAttentionPanel and
  // the KPI header below; Cases by Stage no longer reads from this.
  const { data: allCases } = useCases();
  const allViewModels = useCaseViewModels(allCases);
  const kpis = useMemo(() => computeKpis(allViewModels), [allViewModels]);
  const urgentCases = useMemo(() => allViewModels.filter((c) => c.needsAttention), [allViewModels]);

  // Cases by Stage's navigation hub — server-side counts only (Phase 2),
  // never every Case object. Dashboard has no search of its own (search
  // belongs to the dedicated case-list route), so this is always the
  // organization's unfiltered counts.
  const { data: countsData } = useCaseCounts({ searchQuery: '' });
  const stageBreakdownRows: StageBarRow[] = useMemo(() => {
    const counts = STAGES.map((label) => countsData?.byStage[label] ?? null);
    const maxCount = Math.max(1, ...counts.map((c) => c ?? 0));
    return STAGES.map((label, index) => ({
      label,
      count: counts[index],
      pct: counts[index] === null ? 0 : Math.round((counts[index]! / maxCount) * 100),
    }));
  }, [countsData]);

  return (
    <div>
      <PageGreetingHeader todayLabel={todayLabel} activeCount={kpis.activeCases} />

      <div className={styles.stageOverviewGrid}>
        <NeedsAttentionPanel cases={urgentCases} />
        <CasesByStagePanel allCasesCount={countsData?.total ?? null} rows={stageBreakdownRows} />
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
