import { useMemo } from 'react';
import type { Case } from '@/types/case';
import { buildCaseViewModel } from '@/domain/cases/viewModel';
import { useStaff } from './useStaff';

/**
 * Plural counterpart to useCaseViewModel (Phase 4) — needed once a screen
 * (Dashboard) has to derive view models for a whole list rather than one
 * case. Still just a thin memoizing wrapper; the derivation itself lives in
 * domain/cases/viewModel.ts, per docs/adr/ADR-004-domain-layer.md.
 */
export function useCaseViewModels(cases: Case[] | undefined) {
  const { data: staffList = [] } = useStaff();

  return useMemo(() => {
    if (!cases) return [];
    // Defensive: never trust the input array has no holes (Case list
    // scalability, Phase 3 — the paginated hook's flattened
    // `pages.flatMap(p => p.cases)` is a plain array of real Case objects
    // in every normal code path, but this guards against ever handing
    // buildCaseViewModel a nullish entry instead of silently crashing the
    // whole list on one bad item).
    return cases.filter((case_): case_ is Case => Boolean(case_)).map((case_) => buildCaseViewModel(case_, { staffList }));
  }, [cases, staffList]);
}
