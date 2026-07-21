import { useMemo } from 'react';
import type { Case } from '@/types/case';
import { buildCaseViewModel } from '@/domain/cases/viewModel';
import { useStaff } from './useStaff';

/**
 * Thin memoizing wrapper — the derivation logic itself lives in
 * domain/cases/viewModel.ts, not here, per docs/adr/ADR-004-domain-layer.md.
 */
export function useCaseViewModel(
  case_: Case | null | undefined,
  viewingDisplayStage: number | null = null,
) {
  const { data: staffList = [] } = useStaff();

  return useMemo(() => {
    if (!case_) return null;
    return buildCaseViewModel(case_, { staffList, viewingDisplayStage });
  }, [case_, staffList, viewingDisplayStage]);
}
