'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCaseListPage } from '@/hooks/useCaseListPage';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import { useCaseCounts } from '@/hooks/useCaseCounts';
import { useAdvanceCaseStage } from '@/hooks/useAdvanceCaseStage';
import { useOrganization } from '@/hooks/useOrganization';
import { STAGES } from '@/domain/cases/stages';
import {
  canonicalDisplayStagesForPresentedLabel,
  presentedStageLabels,
} from '@/domain/organization/workflowStagePresentation';
import { AllCasesList } from '@/components/dashboard/AllCasesList';
import { StageFilteredPanel } from '@/components/dashboard/StageFilteredPanel';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './page.module.css';

/**
 * Manors intake-stage combination (2026-10). Accepts any USER-FACING stage
 * label for this organization, plus — for backward compatibility — the
 * canonical labels the overlay merges away, so an existing bookmark or
 * shared link using "First Call & Payment" or "Jotform Application" keeps
 * resolving exactly as it did before. The server applies the same rule
 * (see app/api/cases/route.ts).
 */
function isValidStage(value: string | null, organizationId: string): boolean {
  if (value === null) return false;
  if ((STAGES as readonly string[]).includes(value)) return true;
  return presentedStageLabels(organizationId, STAGES).includes(value);
}

/**
 * Case list route — SOLIS Phase 2 (presentation only).
 *
 * Unchanged: `?stage=` routing + stale-value fallback, server-side
 * paginated/searched query (useCaseListPage + useCaseSearch), selection +
 * Advance on stage pages, Load More, loading/error/empty states.
 *
 * New presentation:
 *  - Header: title + "{n} active" from the EXISTING counts endpoint
 *    (useCaseCounts — the same one the Dashboard uses).
 *  - Toolbar: a search field bound to the SAME shared useCaseSearch()
 *    context the TopBar search already writes to (no new search logic —
 *    typing in either box updates both), and a Stage menu that simply
 *    navigates to the EXISTING /cases and /cases?stage=<label> routes.
 *  - No Status filter: there is no confirmed case-status field to filter on.
 */
function CasesPageContent() {
  const router = useRouter();
  const { organizationId } = useOrganization();
  const searchParams = useSearchParams();
  const stageParam = searchParams.get('stage');
  const stage = isValidStage(stageParam, organizationId) ? stageParam : null;

  const { query, setQuery, debouncedQuery, submitQuery } = useCaseSearch();
  const [selectedCaseIds, setSelectedCaseIds] = useState<Record<string, boolean>>({});
  const advanceStage = useAdvanceCaseStage();

  const listQuery = useCaseListPage({ stage, searchQuery: debouncedQuery });
  const flatCases = useMemo(() => listQuery.data?.pages.flatMap((page) => page.cases) ?? [], [listQuery.data]);
  const listViewModels = useCaseViewModels(flatCases);

  const { data: countsData } = useCaseCounts({ searchQuery: '' });
  // `byStage` is keyed by CANONICAL stage labels, while `stage` may be a
  // user-facing label covering more than one of them (Manors' combined
  // intake). Sum the canonical counts it covers — those map to disjoint
  // raw-stage sets, so the sum is exact.
  const headerCount = useMemo(() => {
    if (stage === null) return countsData?.total;
    if (!countsData) return undefined;
    const canonical = canonicalDisplayStagesForPresentedLabel(organizationId, stage, STAGES);
    if (!canonical) return undefined;
    return canonical.reduce((sum, ds) => sum + (countsData.byStage[STAGES[ds]] ?? 0), 0);
  }, [stage, countsData, organizationId]);

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

  function handleStageChange(value: string) {
    setSelectedCaseIds({});
    router.push(value === '' ? '/cases' : `/cases?stage=${encodeURIComponent(value)}`);
  }

  return (
    <div className={styles.page}>
      <Link href="/dashboard" className={styles.backLink}>
        ← Back to Dashboard
      </Link>

      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.heading}>{heading}</h1>
          {headerCount !== undefined && headerCount !== null && (
            <span className={styles.count}>{headerCount} active</span>
          )}
        </div>
        <div className={styles.subheading}>{subheading}</div>
      </header>

      <div className={styles.toolbar} role="search">
        <label className={styles.search}>
          <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <span className={styles.srOnly}>Search cases</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // This list already filters as you type, so Return's job is
              // to stop waiting: apply the term now instead of after the
              // debounce, and dismiss the on-screen keyboard so results
              // are actually visible on a phone.
              event.preventDefault();
              submitQuery();
              event.currentTarget.blur();
            }}
            // Labels the mobile keyboard's Return key "Search" rather
            // than a generic return, so pressing it reads as the obvious
            // way to run the search.
            enterKeyHint="search"
            placeholder="Search cases…"
            className={styles.searchInput}
          />
        </label>
        <div className={styles.toolbarSpacer} />
        <label className={styles.selectWrap}>
          <span className={styles.srOnly}>Stage</span>
          <select
            className={styles.select}
            value={stage ?? ''}
            onChange={(event) => handleStageChange(event.target.value)}
          >
            <option value="">All stages</option>
            {presentedStageLabels(organizationId, STAGES).map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <svg className={styles.chevron} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </label>
      </div>

      {listQuery.isLoading && <EmptyState message="Loading cases…" />}

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
