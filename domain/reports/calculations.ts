import type { CaseViewModel, BadgeVariant } from '../../types/caseViewModel';
import type { StaffProfile } from '../../types/staffProfile';
import { STAGES, LAST_DISPLAY_STAGE } from '../cases/stages';
import { presentedStages } from '../organization/workflowStagePresentation';
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
 * The per-stage grouping the stage-breakdown view needs, bucketed by
 * USER-FACING stage rather than canonical display stage — so Manors'
 * two historical intake stages fall into one "Intake & JotForm" bucket.
 *
 * Buckets stay mutually exclusive and exhaustive: every canonical display
 * stage belongs to exactly one presented stage, so no case is counted
 * twice and none is dropped. See
 * domain/organization/workflowStagePresentation.ts.
 */
export function groupCasesByPresentedStage(cases: CaseViewModel[], organizationId: string): CaseViewModel[][] {
  return presentedStages(organizationId, STAGES).map((stage) =>
    cases.filter((c) => stage.canonicalDisplayStages.includes(c.displayStage)),
  );
}

/**
 * The SLA target for one user-facing stage.
 *
 * For a stage covering a single canonical display stage this is simply
 * that stage's own target, unchanged. For Manors' combined intake stage
 * it is the MAXIMUM of the covered targets (First Call 0.25d, JotForm
 * Application 1d -> 1d), never their sum.
 *
 * Summing would be wrong: `daysWaitingInStage` restarts whenever a case
 * enters a new stage, so no single case's wait ever spans both intake
 * stages. Every case counted in the merged row is really sitting in
 * exactly one of them, so the row is only a genuine bottleneck once the
 * average wait exceeds the longest budget among the stages it covers.
 * Taking the max therefore avoids flagging a false bottleneck — the
 * specific risk that merging these rows introduces — while still
 * surfacing a genuinely slow intake phase.
 *
 * Per-case overdue (domain/cases/sla.ts#isOverdue) is untouched and still
 * evaluates against the case's own canonical stage, so no individual
 * case's overdue status changes because of this merge.
 */
function presentedStageSlaTargetDays(canonicalDisplayStages: number[]): number | null {
  const targets = canonicalDisplayStages
    .map((displayStage) => getSlaTargetDays(displayStage))
    .filter((target): target is number => target != null);
  return targets.length === 0 ? null : Math.max(...targets);
}

export function computeStageBreakdown(cases: CaseViewModel[], organizationId: string): StageBreakdownRow[] {
  const presented = presentedStages(organizationId, STAGES);
  const grouped = groupCasesByPresentedStage(cases, organizationId);

  return presented.map((stage, index) => {
    const inStage = grouped[index];
    const target = presentedStageSlaTargetDays(stage.canonicalDisplayStages);
    const avgDays = inStage.length
      ? inStage.reduce((sum, c) => sum + c.daysWaitingInStage, 0) / inStage.length
      : 0;
    const isBottleneck = target != null && avgDays > target;

    return {
      label: stage.label,
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
