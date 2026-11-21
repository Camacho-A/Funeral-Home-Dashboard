'use client';

import { useMemo, useState, useEffect } from 'react';
import { slaSummaryBucket, type SlaMilestoneEvaluation } from '@/domain/sla/slaMilestones';
import { useCases } from '@/hooks/useCases';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { computeKpis } from '@/domain/reports/calculations';
import { useOrganization } from '@/hooks/useOrganization';
import { useDashboardData } from '@/hooks/useDashboard';
import { usePortfolio } from '@/hooks/usePortfolio';
import { CombinedDashboard } from '@/components/portfolio/CombinedDashboard';
import { PageGreetingHeader } from '@/components/dashboard/PageGreetingHeader';
import { DashboardKpiStrip } from '@/components/dashboard/DashboardKpiStrip';
import { NeedsAttentionPanel } from '@/components/dashboard/NeedsAttentionPanel';
import { CasesByStagePanel, type StagePreviewCase } from '@/components/dashboard/CasesByStagePanel';
import { useStageBreakdownRows } from '@/hooks/useStageBreakdownRows';
import { RecentActivityPanel } from '@/components/dashboard/RecentActivityPanel';
import { UpcomingServicesPanel } from '@/components/dashboard/UpcomingServicesPanel';
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
/** Unified portal (Phase 5N): "All authorized organizations" shows the combined, view-only Dashboard. */
export default function DashboardPage() {
  const { combined } = usePortfolio();
  return combined ? <CombinedDashboard /> : <OrganizationDashboard />;
}

function OrganizationDashboard() {
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
  const kpis = useMemo(() => computeKpis(allViewModels, organizationId), [allViewModels, organizationId]);
  // SLA tracking (2026-10): Needs Attention already includes SLA cases (the
  // view model decides, from the shared evaluation); the most urgent first.
  const urgentCases = useMemo(
    () => allViewModels.filter((c) => c.needsAttention).sort((a, b) => slaUrgency(a.sla?.current ?? null) - slaUrgency(b.sla?.current ?? null)),
    [allViewModels],
  );
  const slaSummary = useMemo(() => {
    if (!allViewModels.some((c) => c.sla?.enabled)) return null;
    const counts = { onTrack: 0, dueToday: 0, overdue: 0, waiting: 0, startDateNeeded: 0 };
    for (const c of allViewModels) {
      const bucket = slaSummaryBucket(c.sla?.current ?? null);
      if (bucket === 'on_track') counts.onTrack += 1;
      else if (bucket === 'due_today') counts.dueToday += 1;
      else if (bucket === 'overdue') counts.overdue += 1;
      else if (bucket === 'waiting') counts.waiting += 1;
      else if (bucket === 'start_date_needed') counts.startDateNeeded += 1;
    }
    return counts;
  }, [allViewModels]);

  // Cases by Stage's navigation hub — server-side counts only (Phase 2),
  // never every Case object; this organization's own stage model
  // (hooks/useStageBreakdownRows.ts).
  const { rows: stageBreakdownRows, total: allCasesCount } = useStageBreakdownRows();

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
          <NeedsAttentionPanel cases={urgentCases} slaSummary={slaSummary} />
          <UpcomingServicesPanel />
        </div>
        <div className={styles.stageArea}>
          <CasesByStagePanel allCasesCount={allCasesCount} rows={stageBreakdownRows} casesByStage={casesByStage} />
        </div>
        <div className={styles.activityArea}>
          <RecentActivityPanel />
        </div>
      </div>
    </div>
  );
}

/** Overdue first, then due today, a missing start date, an external wait
    past its target, and finally due soon; non-SLA attention (stalled) last. */
function slaUrgency(current: SlaMilestoneEvaluation | null): number {
  if (!current?.status) return 9;
  if (current.status === 'overdue') return current.advisory ? 5 : 0;
  if (current.status === 'due_today') return 1;
  if (current.status === 'start_date_needed') return 2;
  if (current.overdue) return 3;
  return 4;
}
