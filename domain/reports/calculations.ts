import type { CaseViewModel, BadgeVariant } from '../../types/caseViewModel';
import type { StaffProfile } from '../../types/staffProfile';
import { STAGES, LAST_DISPLAY_STAGE } from '../cases/stages';
import { getSlaTargetDays, formatSlaTarget } from '../cases/sla';
import { VA_STEPS } from '../cases/veteran';

/**
 * Reports-screen calculations, ported from design/support.js's renderVals().
 * Operate on already-derived CaseViewModel[] (via domain/cases/viewModel.ts),
 * not raw Case[] — displayStage/isOverdue/ownerName are derived fields, so
 * computing reports from anything else would duplicate that derivation.
 */

export function computeKpis(cases: CaseViewModel[]) {
  const active = cases.filter((c) => c.displayStage < LAST_DISPLAY_STAGE);
  return {
    activeCases: active.length,
    completedCases: cases.filter((c) => c.displayStage === LAST_DISPLAY_STAGE).length,
    overdueCases: cases.filter((c) => c.isOverdue).length,
    totalCases: cases.length,
  };
}

export type StageBreakdownRow = {
  label: string;
  count: number;
  avgDays: number;
  targetLabel: string;
  isBottleneck: boolean;
  avgColor: Extract<BadgeVariant, 'danger' | 'neutral'>;
};

/**
 * The per-stage grouping every stage-breakdown view needs (Reports' fuller
 * version here, and the Dashboard's simpler count+percentage bar chart) —
 * factored out so both call one shared function instead of each re-deriving
 * "filter cases by displayStage" independently.
 */
export function groupCasesByDisplayStage(cases: CaseViewModel[]): CaseViewModel[][] {
  return STAGES.map((_, displayStage) => cases.filter((c) => c.displayStage === displayStage));
}

export function computeStageBreakdown(cases: CaseViewModel[]): StageBreakdownRow[] {
  const grouped = groupCasesByDisplayStage(cases);
  return STAGES.map((label, displayStage) => {
    const inStage = grouped[displayStage];
    const target = getSlaTargetDays(displayStage);
    const avgDays = inStage.length
      ? inStage.reduce((sum, c) => sum + c.daysWaitingInStage, 0) / inStage.length
      : 0;
    const isBottleneck = target != null && avgDays > target;

    return {
      label,
      count: inStage.length,
      avgDays: Math.round(avgDays * 10) / 10,
      targetLabel: formatSlaTarget(target),
      isBottleneck,
      avgColor: isBottleneck ? 'danger' : 'neutral',
    };
  });
}

export type StaffWorkloadRow = {
  staffId: string;
  name: string;
  activeCaseCount: number;
  overdueCaseCount: number;
};

export function computeStaffWorkload(
  cases: CaseViewModel[],
  staffList: StaffProfile[],
): StaffWorkloadRow[] {
  return staffList.map((staff) => {
    const owned = cases.filter(
      (c) => c.ownerStaffId === staff.id && c.displayStage < LAST_DISPLAY_STAGE,
    );
    return {
      staffId: staff.id,
      name: staff.displayName,
      activeCaseCount: owned.length,
      overdueCaseCount: owned.filter((c) => c.isOverdue).length,
    };
  });
}

export type VeteranCaseStatusRow = {
  caseId: string;
  decedentName: string;
  status: 'complete' | 'in_progress';
};

export function computeVeteranCaseStatuses(cases: CaseViewModel[]): VeteranCaseStatusRow[] {
  return cases
    .filter((c) => c.isVeteran)
    .map((c) => ({
      caseId: c.id,
      decedentName: c.decedentName,
      status: c.vaComplete ? 'complete' : 'in_progress',
    }));
}

/** Sanity re-export so callers don't need a second import just to know how
    many VA steps exist (e.g. for a progress fraction). */
export const VA_STEP_COUNT = VA_STEPS.length;
