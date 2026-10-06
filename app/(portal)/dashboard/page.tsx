'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCases } from '@/hooks/useCases';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { useCaseCounts } from '@/hooks/useCaseCounts';
import { STAGES } from '@/domain/cases/stages';
import { presentedStages } from '@/domain/organization/workflowStagePresentation';
import { computeKpis } from '@/domain/reports/calculations';
import { useOrganization } from '@/hooks/useOrganization';
import { useDashboardData } from '@/hooks/useDashboard';
import { PageGreetingHeader } from '@/components/dashboard/PageGreetingHeader';
import { DashboardKpiStrip } from '@/components/dashboard/DashboardKpiStrip';
import { NeedsAttentionPanel } from '@/components/dashboard/NeedsAttentionPanel';
import { CasesByStagePanel, type StageBarRow, type StagePreviewCase } from '@/components/dashboard/CasesByStagePanel';
import { RecentActivityPanel } from '@/components/dashboard/RecentActivityPanel';
import styles from './page.module.css';

/**
 * Case list scalability, Phase 3 — UX correction (2026-09). The Dashboard
 * is a fixed-height SUMMARY/command center: its height must never grow
 * with the organization's case count. The prior iteration of this phase
 * rendered an 8-tab bar plus a full, paginated case list directly on this
 * page — that direction was explicitly reversed.
 *
 * Cases by Stage (components/dashboard/CasesByStagePanel.tsx) remains a
 * NAVIGATION HUB: "All cases" plus each of the 7 canonical stages are
 * real links into the dedicated case-list route (`/cases`, optionally
 * `?stage=<STAGES label>`; see app/(portal)/cases/page.tsx). The one
 * explicitly approved exception (SOLIS true redesign, Phase 1, 2026-10)
 * is the Stage Preview accordion: clicking a stage row expands an inline
 * preview of that stage's cases directly beneath it — a Dashboard
 * convenience layer, never a replacement for the full stage page, which
 * remains exactly as reachable via "Open full stage list →".
 *
 * Stage/All-Cases counts still come from the Phase 2 counts endpoint
 * (useCaseCounts) — never a client-side aggregation. The Stage Preview's
 * own expanded case rows (case number, name, days-in-stage), by
 * contrast, are grouped from `allViewModels` below — the SAME already-
 * fetched, complete-result array `useCases()`/`useCaseViewModels()`
 * already provide for NeedsAttentionPanel/the KPI strip, so expanding a
 * stage never fires a new network request. An organization with more
 * cases than that fetch's own window would see a preview that can
 * under-count relative to the stage row's own server-side number — an
 * accepted, reported tradeoff, the same one already documented below for
 * NeedsAttentionPanel's identical data source.
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

  // Legacy, complete-result fetch — kept ONLY for NeedsAttentionPanel, the
  // KPI strip, and (SOLIS true redesign, Phase 1) the Stage Preview
  // accordion's own case rows; Cases by Stage's header counts/bar still
  // read from the server-side counts endpoint below, never from this.
  const { data: allCases } = useCases();
  const allViewModels = useCaseViewModels(allCases);
  const kpis = useMemo(() => computeKpis(allViewModels), [allViewModels]);
  const urgentCases = useMemo(() => allViewModels.filter((c) => c.needsAttention), [allViewModels]);

  // Cases by Stage's navigation hub — server-side counts only (Phase 2),
  // never every Case object.
  const { data: countsData } = useCaseCounts({ searchQuery: '' });
  // Manors intake-stage combination (2026-10). Rows are the USER-FACING
  // stages, so Manors shows six instead of seven. A presented stage's
  // count is the SUM of the canonical per-stage counts it covers; those
  // canonical stages map to disjoint raw-stage sets (First Call is raw
  // 0-1, Jotform Application is raw 2), so summing them can neither
  // double-count nor omit a case, and the separate `total` is untouched.
  // `displayStage` stays a canonical value — it only drives stage colour
  // and the bottleneck flag. See
  // domain/organization/workflowStagePresentation.ts.
  const stageBreakdownRows: StageBarRow[] = useMemo(() => {
    const presented = presentedStages(organizationId, STAGES);
    const counts = presented.map((stage) => {
      const parts = stage.canonicalDisplayStages.map((ds) => countsData?.byStage[STAGES[ds]] ?? null);
      return parts.every((part) => part === null)
        ? null
        : parts.reduce((sum, part) => (sum ?? 0) + (part ?? 0), 0 as number | null);
    });
    const maxCount = Math.max(1, ...counts.map((c) => c ?? 0));
    return presented.map((stage, index) => ({
      label: stage.label,
      count: counts[index],
      pct: counts[index] === null ? 0 : Math.round((counts[index]! / maxCount) * 100),
      displayStage: stage.canonicalDisplayStages[0],
    }));
  }, [countsData, organizationId]);

  // Stage Preview's own case rows (SOLIS true redesign, Phase 1) — grouped
  // from the already-fetched `allViewModels`, keyed by the case's own
  // current `stageLabel`. No new query; no business/filtering logic
  // duplicated (`stageLabel` is computed once, in domain/cases/viewModel.ts).
  const casesByStage: Record<string, StagePreviewCase[]> = useMemo(() => {
    const grouped: Record<string, StagePreviewCase[]> = {};
    for (const c of allViewModels) {
      (grouped[c.stageLabel] ??= []).push({
        id: c.id,
        caseNumber: c.caseNumber,
        decedentName: c.decedentName,
        daysWaitingInStage: c.daysWaitingInStage,
      });
    }
    return grouped;
  }, [allViewModels]);

  return (
    <div className={styles.pageInner}>
      <PageGreetingHeader todayLabel={todayLabel} />

      <div className={styles.kpiSection}>
        <DashboardKpiStrip
          activeCases={kpis.activeCases}
          attentionCount={urgentCases.length}
          financial={dashboardData?.financial ?? null}
          isLoading={isDashboardLoading}
          isError={isDashboardError}
        />
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.attentionArea}>
          <NeedsAttentionPanel cases={urgentCases} />
        </div>
        <div className={styles.stageArea}>
          <CasesByStagePanel allCasesCount={countsData?.total ?? null} rows={stageBreakdownRows} casesByStage={casesByStage} />
        </div>
        <div className={styles.activityArea}>
          <RecentActivityPanel />
        </div>
      </div>
    </div>
  );
}
