import type { CaseViewModel, BadgeVariant } from '../../types/caseViewModel';
import type { StaffProfile } from '../../types/staffProfile';
import { STAGES, LAST_DISPLAY_STAGE } from '../cases/stages';
import { presentedStages } from '../organization/workflowStagePresentation';
import { getSlaTargetDays, formatSlaTarget } from '../cases/sla';
import { VA_STEPS } from '../cases/veteran';
import type { Case } from '../../types/case';
import { isWorkflowByServiceType } from '../workflow/selectWorkflowTemplate';
import { caseIsInOrganizationStage, type OrganizationStageModel } from '../workflow/organizationStages';
import { findStageByRawStage } from '../workflow/resolveStages';

/**
 * Reports-screen calculations, ported from design/support.js's renderVals().
 * Operate on already-derived CaseViewModel[] (via domain/cases/viewModel.ts),
 * not raw Case[] — displayStage/isOverdue/ownerName are derived fields, so
 * computing reports from anything else would duplicate that derivation.
 */

/**
 * Service-specific workflows (2026-10). Whether a case sits on its OWN
 * workflow's terminal stage — for an organization whose cases run on
 * several templates, where the global LAST_DISPLAY_STAGE constant doesn't
 * describe every case. Read from the case's own (snapshot-derived) stage
 * mapping, so a template with more or fewer stages is handled correctly.
 */
export function isCaseViewOnTerminalStage(c: CaseViewModel): boolean {
  const canonical = c.canonicalDisplayStagesByPresentedIndex?.flat() ?? [];
  const last = canonical.length > 0 ? Math.max(...canonical) : LAST_DISPLAY_STAGE;
  return c.displayStage >= last;
}

export function computeKpis(cases: CaseViewModel[], organizationId?: string) {
  // Service-specific workflows (2026-10): per-case terminal stage for an
  // organization with service workflows; the global constant (unchanged)
  // for everyone else, including every caller that passes no organization.
  const perCase = organizationId !== undefined && isWorkflowByServiceType(organizationId);
  const isCompleted = perCase ? isCaseViewOnTerminalStage : (c: CaseViewModel) => c.displayStage === LAST_DISPLAY_STAGE;
  const isActive = perCase ? (c: CaseViewModel) => !isCaseViewOnTerminalStage(c) : (c: CaseViewModel) => c.displayStage < LAST_DISPLAY_STAGE;
  const active = cases.filter(isActive);
  return {
    activeCases: active.length,
    completedCases: cases.filter(isCompleted).length,
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

/** The (template, version, raw stage) a report row counts a case under. */
export type ReportStageRef = Pick<Case, 'workflowTemplateId' | 'workflowTemplateVersion' | 'rawStage'>;

/**
 * Service-specific workflows (2026-10). Where a REPORT places a case: its
 * own raw stage, except while the view model holds a case on its terminal
 * stage back one position because the return of remains is not yet
 * confirmed (domain/cases/transitions.ts#resolveEffectiveDisplayStage) —
 * then the raw stage of the stage it is shown at. That is the position
 * every other report figure already uses (`displayStage`, which the
 * active/completed KPIs read), and exactly how Manors' report rows bucket
 * by `displayStage`; without it such a case would be both "active" and in
 * the "Completed" row. The Dashboard's server-side counts are unaffected
 * (raw stage, for every organization).
 */
export function reportStageRef(case_: Case, view: Pick<CaseViewModel, 'displayStage'>): ReportStageRef {
  const ref = { workflowTemplateId: case_.workflowTemplateId, workflowTemplateVersion: case_.workflowTemplateVersion, rawStage: case_.rawStage };
  const snapshot = case_.workflowSnapshot;
  if (!snapshot || findStageByRawStage(snapshot, case_.rawStage)?.displayStage === view.displayStage) return ref;
  const shownAt = snapshot.stages.filter((stage) => stage.displayStage === view.displayStage).map((stage) => stage.rawStage);
  return shownAt.length === 0 ? ref : { ...ref, rawStage: Math.max(...shownAt) };
}

/**
 * Service-specific workflows (2026-10). The stage breakdown for an
 * organization whose cases run on several templates: one row per
 * ORGANIZATION stage (domain/workflow/organizationStages.ts), a case
 * belonging to a row by its own (workflowTemplateId, rawStage) — the same
 * membership the Dashboard counts and Cases list filter use — and each
 * row's SLA target taken from the templates themselves. `caseRefs` maps a
 * view model's id to its case's template/version/raw stage (view models
 * don't carry the template id) — see reportStageRef.
 */
export function computeStageBreakdownByOrganizationStage(
  cases: CaseViewModel[],
  model: OrganizationStageModel,
  caseRefs: ReadonlyMap<string, Pick<Case, 'workflowTemplateId' | 'rawStage'> & Partial<Pick<Case, 'workflowTemplateVersion'>>>,
): StageBreakdownRow[] {
  return model.stages.map((stage) => {
    const inStage = cases.filter((c) => {
      const ref = caseRefs.get(c.id);
      return ref !== undefined && caseIsInOrganizationStage(stage, ref);
    });
    const target = stage.slaTargetDays;
    const avgDays = inStage.length ? inStage.reduce((sum, c) => sum + c.daysWaitingInStage, 0) / inStage.length : 0;
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
  organizationId?: string,
): StaffWorkloadRow[] {
  const isActive =
    organizationId && isWorkflowByServiceType(organizationId)
      ? (c: CaseViewModel) => !isCaseViewOnTerminalStage(c)
      : (c: CaseViewModel) => c.displayStage < LAST_DISPLAY_STAGE;
  return staffList.map((staff) => {
    const owned = cases.filter(
      (c) => c.ownerStaffId === staff.id && isActive(c),
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
