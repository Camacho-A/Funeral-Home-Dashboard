'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCases } from '@/hooks/useCases';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import { useAdvanceCaseStage } from '@/hooks/useAdvanceCaseStage';
import { STAGES } from '@/domain/cases/stages';
import { computeKpis, groupCasesByDisplayStage } from '@/domain/reports/calculations';
import { compareCasesByUrgency } from '@/domain/cases/viewModel';
import { activityFeedFixtures } from '@/services/__mocks__/fixtures';
import { PageGreetingHeader } from '@/components/dashboard/PageGreetingHeader';
import { NeedsAttentionPanel } from '@/components/dashboard/NeedsAttentionPanel';
import { CasesByStagePanel } from '@/components/dashboard/CasesByStagePanel';
import { AllCasesList } from '@/components/dashboard/AllCasesList';
import { StageFilteredPanel } from '@/components/dashboard/StageFilteredPanel';
import { RecentActivityPanel } from '@/components/dashboard/RecentActivityPanel';
import styles from './page.module.css';

/**
 * Dashboard page (Frontend Engineering Plan, Phase 5) — the orchestration
 * layer. Fetches via hooks, derives display data via useMemo (only
 * aggregation/sorting specific to this one screen; every actual business
 * rule — stages, SLA, checklist, attention, row-summary text — comes from
 * domain/ through CaseViewModel, not recomputed here), and owns the two
 * pieces of UI-local state the plan calls for (search query lives in the
 * shared useCaseSearch context since TopBar renders outside this page;
 * stage filter and bulk-selection are local to this page).
 */
export default function DashboardPage() {
  const { query: searchQuery } = useCaseSearch();
  const [stageFilter, setStageFilter] = useState<number | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Record<string, boolean>>({});
  const [todayLabel, setTodayLabel] = useState('');

  // Computed client-side only, after mount — this route is statically
  // prerendered, so a plain `new Date()` in render would bake in a stale
  // build-time date. The prototype hardcodes a fake date ("Wednesday, July
  // 15"); showing the real current date is a deliberate, documented
  // deviation from that literal text.
  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    );
  }, []);

  const { data: allCases } = useCases();
  const { data: searchedCases } = useCases({ searchQuery });
  const allViewModels = useCaseViewModels(allCases);
  const searchedViewModels = useCaseViewModels(searchedCases);
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
      selected: stageFilter === index,
    }));
  }, [allViewModels, stageFilter]);

  const sortedSearchedCases = useMemo(
    () => [...searchedViewModels].sort(compareCasesByUrgency),
    [searchedViewModels],
  );

  const stageFilteredCases = useMemo(
    () => (stageFilter === null ? [] : groupCasesByDisplayStage(allViewModels)[stageFilter]),
    [allViewModels, stageFilter],
  );

  const selectedCount = Object.values(selectedCaseIds).filter(Boolean).length;

  function handleSelectStage(index: number) {
    setStageFilter((current) => (current === index ? null : index));
    setSelectedCaseIds({});
  }

  function handleToggleSelect(caseId: string) {
    setSelectedCaseIds((current) => ({ ...current, [caseId]: !current[caseId] }));
  }

  function handleBack() {
    setStageFilter(null);
    setSelectedCaseIds({});
  }

  function handleAdvance() {
    const selected = (allCases ?? []).filter((c) => selectedCaseIds[c.id]);
    advanceStage.mutate(selected, {
      onSuccess: () => setSelectedCaseIds({}),
    });
  }

  return (
    <div>
      <PageGreetingHeader todayLabel={todayLabel} activeCount={kpis.activeCases} />

      <div className={styles.stageOverviewGrid}>
        <NeedsAttentionPanel cases={urgentCases} />
        <CasesByStagePanel rows={stageBreakdownRows} onSelectStage={handleSelectStage} />
      </div>

      {stageFilter === null && (
        <AllCasesList cases={sortedSearchedCases} searchQuery={searchQuery} />
      )}

      {stageFilter !== null && (
        <StageFilteredPanel
          stageLabel={STAGES[stageFilter]}
          cases={stageFilteredCases.map((c) => ({
            ...c,
            selected: Boolean(selectedCaseIds[c.id]),
          }))}
          selectedCount={selectedCount}
          onToggleSelect={handleToggleSelect}
          onAdvance={handleAdvance}
          onBack={handleBack}
        />
      )}

      <RecentActivityPanel entries={activityFeedFixtures} />
    </div>
  );
}
