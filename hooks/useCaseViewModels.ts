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
    return cases.map((case_) => buildCaseViewModel(case_, { staffList }));
  }, [cases, staffList]);
}
