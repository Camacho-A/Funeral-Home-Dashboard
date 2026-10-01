'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCaseListPage } from '@/hooks/useCaseListPage';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import { useAdvanceCaseStage } from '@/hooks/useAdvanceCaseStage';
import { STAGES } from '@/domain/cases/stages';
import { AllCasesList } from '@/components/dashboard/AllCasesList';
import { StageFilteredPanel } from '@/components/dashboard/StageFilteredPanel';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './page.module.css';

function isValidStage(value: string | null): value is (typeof STAGES)[number] {
  return value !== null && (STAGES as readonly string[]).includes(value);
}

/**
 * The dedicated case-list route (Case list scalability, Phase 3 — UX
 * correction, 2026-09). One reusable view for both "All Cases" (no
 * `?stage=`) and any single canonical stage (`?stage=<STAGES label>`,
 * the exact label `GET /api/cases`'s own `stage` param already uses —
 * not a second, page-only id scheme). Reached by navigating here from
 * the Dashboard's Cases by Stage panel (components/dashboard/
 * CasesByStagePanel.tsx); never rendered inline on the Dashboard itself.
 *
 * An unrecognized/stale `?stage=` value (e.g. a bookmarked URL from
 * before a stage was renamed) falls back to All Cases rather than
 * erroring, matching the previous tabbed Dashboard's own behavior.
 *
 * All querying is the Phase 1/2 bounded, cursor-paginated, server-side-
 * filtered/searched architecture (useCaseListPage, useCaseSearch) —
 * never a fetch-all-then-filter-in-React approach. Search reads the
 * same shared useCaseSearch() context the persistent TopBar's search box
 * already writes to (components/layout/TopBar.tsx) — this page is simply
 * the one screen that now consumes it, exactly as the Dashboard used to
 * before this correction.
 */
function CasesPageContent() {
  const searchParams = useSearchParams();
  const stageParam = searchParams.get('stage');
  const stage = isValidStage(stageParam) ? stageParam : null;

  const { debouncedQuery } = useCaseSearch();
  const [selectedCaseIds, setSelectedCaseIds] = useState<Record<string, boolean>>({});
  const advanceStage = useAdvanceCaseStage();

  const listQuery = useCaseListPage({ stage, searchQuery: debouncedQuery });
  const flatCases = useMemo(() => listQuery.data?.pages.flatMap((page) => page.cases) ?? [], [listQuery.data]);
  const listViewModels = useCaseViewModels(flatCases);

  const heading = stage ?? 'All Cases';
  const subheading =
    stage === null
      ? 'All cases across every workflow stage.'
      : `Showing cases currently in: ${stage}.`;
  const emptyMessage =
    debouncedQuery.trim() !== '' ? 'No cases found.' : stage !== null ? 'No cases in this stage.' : 'No cases yet.';
  const selectedCount = Object.values(selectedCaseIds).filter(Boolean).length;

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
      <Link href="/dashboard" className={styles.backLink}>
        ← Back to Dashboard
      </Link>
      <div className={styles.heading}>{heading}</div>
      <div className={styles.subheading}>{subheading}</div>

      {listQuery.isLoading && <EmptyState message="Loading cases…" />}

      {/* A failed Load More (fetchNextPage) must never replace the
          already-loaded page — gated on `!listQuery.data` specifically,
          not just `isError`, since React Query marks the query `isError`
          for a failed fetchNextPage too, even though `data` (page 1) is
          still fully intact. Only an initial-load failure (no data at
          all yet) shows this full error/retry state. */}
      {!listQuery.isLoading && listQuery.isError && !listQuery.data && (
        <div className={styles.errorState}>
          <EmptyState message="Unable to load cases right now." />
          <Button variant="secondary" onClick={() => listQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!listQuery.isLoading && listQuery.data && stage === null && (
        <AllCasesList
          cases={listViewModels}
          emptyMessage={emptyMessage}
          hasMore={Boolean(listQuery.hasNextPage)}
          isLoadingMore={listQuery.isFetchingNextPage}
          onLoadMore={() => {
            listQuery.fetchNextPage().catch(() => {});
          }}
        />
      )}

      {!listQuery.isLoading && listQuery.data && stage !== null && (
        <StageFilteredPanel
          cases={listViewModels.map((c) => ({ ...c, selected: Boolean(selectedCaseIds[c.id]) }))}
          emptyMessage={emptyMessage}
          selectedCount={selectedCount}
          onToggleSelect={handleToggleSelect}
          onAdvance={handleAdvance}
          hasMore={Boolean(listQuery.hasNextPage)}
          isLoadingMore={listQuery.isFetchingNextPage}
          onLoadMore={() => {
            listQuery.fetchNextPage().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

export default function CasesPage() {
  return (
    <Suspense fallback={<EmptyState message="Loading…" />}>
      <CasesPageContent />
    </Suspense>
  );
}
