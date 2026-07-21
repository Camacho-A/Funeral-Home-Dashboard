import type { Case } from '../../types/case';
import type { StaffProfile } from '../../types/staffProfile';
import type { CaseViewModel, RequiredDocumentViewModel } from '../../types/caseViewModel';
import { resolveChecklist } from '../workflow/resolveChecklist';
import {
  findStageByRawStage,
  findStageByDisplayStage,
  displayStagesInOrder,
  lastDisplayStage,
  isOverdue,
} from '../workflow/resolveStages';
import { resolveEffectiveDisplayStage } from './transitions';
import { formatSlaTarget } from './sla';
import {
  buildVaSteps,
  isVaCallbackDone,
  isVaComplete,
  isVeteranFlagLocked,
  needsVeteranAttention,
  VA_STEPS,
} from './veteran';
import { buildTimeline } from './timeline';
import { initialsFromName } from '../../utils/string';

export type CaseViewModelContext = {
  staffList: StaffProfile[];
  /** Set when the caller is viewing a past stage's checklist read-only
      (Phase 6's StageStepper). Only affects the `checklist` field — every
      other field always reflects the case's real, current state. */
  viewingDisplayStage?: number | null;
};

function resolveOwner(case_: Case, staffList: StaffProfile[]): { name: string; initials: string } {
  const staff = staffList.find((s) => s.id === case_.assignedStaffId);
  const name = staff?.displayName ?? '—';
  const initials = name === '—' ? '?' : initialsFromName(name);
  return { name, initials };
}

/**
 * Auto-required documents by stage — ported from design/support.js's
 * buildCase(). Uses raw stage thresholds directly, matching the source
 * exactly. Uploaded documents (from the compliance/document service, see
 * docs/ARCHITECTURE.md) are merged in by the caller in Phase 6 — this only
 * computes the stage-driven baseline, which is pure domain logic with no
 * service dependency. Unchanged by Phase 11 (see docs/TEMPLATE_VERSIONING.md's
 * "Known scope limits" — required-document rules aren't templatized this
 * phase; Managed Cremations is the only organization with real documents).
 */
function buildRequiredDocuments(rawStage: number): RequiredDocumentViewModel[] {
  if (rawStage >= 4) {
    return [
      { label: 'Death Certificate', status: rawStage >= 5 ? 'filed' : 'pending' },
      { label: 'Cremation Permit', status: 'signed' },
    ];
  }
  return [{ label: 'Cremation Authorization', status: rawStage >= 3 ? 'signed' : 'pending' }];
}

/**
 * Phase 11 (Workflow Template Architecture): stage/checklist/SLA resolution
 * now reads case_.workflowSnapshot (via domain/workflow/*) instead of the
 * hardcoded domain/cases/stages.ts constants — this is what actually lets a
 * differently-shaped organization's case resolve correctly through this
 * exact function, not a parallel/untested path. Managed Cremations behaves
 * identically to before because its snapshot is built from those same
 * constants (see services/__mocks__/workflowTemplates.ts).
 */
export function buildCaseViewModel(case_: Case, context: CaseViewModelContext): CaseViewModel {
  const { staffList, viewingDisplayStage = null } = context;

  const snapshot = case_.workflowSnapshot;
  if (!snapshot) {
    throw new Error(`Case ${case_.id} has no workflowSnapshot — cannot resolve its stages/checklist`);
  }

  const rawDisplayStage = findStageByRawStage(snapshot, case_.rawStage)?.displayStage ?? 0;
  const currentStageItems = findStageByRawStage(snapshot, case_.rawStage)?.checklist.items ?? [];
  const currentChecklist = resolveChecklist(currentStageItems, case_);
  const lastStage = lastDisplayStage(snapshot);
  const effectiveDisplayStage = resolveEffectiveDisplayStage(rawDisplayStage, currentChecklist, lastStage);
  const effectiveStage = findStageByDisplayStage(snapshot, effectiveDisplayStage);
  const stageLabel = effectiveStage?.label ?? '';

  const owner = resolveOwner(case_, staffList);
  // Used for attribution wherever an actor name is needed but the case may
  // be unowned (the timeline, and Phase 6's case log author) — ported from
  // design/support.js's repeated `raw.owner === '—' ? 'Office' : raw.owner`.
  // Named once here so it isn't re-derived at each call site.
  const effectiveOwnerName = owner.name === '—' ? 'Office' : owner.name;
  const slaTargetDays = effectiveStage?.slaTargetDays ?? null;
  const vaSteps = buildVaSteps(case_);

  // needsAttention/attentionReason: faithfully reproduces design/support.js's
  // actual behavior, which is driven solely by `isStalled` — see the
  // "Correction (Phase 4)" note in docs/BUSINESS_RULES.md. The
  // veteran-incomplete branch below is preserved for parity with the source
  // (attentionReason still computes it) but is unreachable via
  // `needsAttention`, exactly as in the original.
  const needsAttention = case_.isStalled;
  const attentionReason = case_.isStalled
    ? (case_.stalledReason ?? '')
    : needsVeteranAttention(case_)
      ? 'Veteran — VA process incomplete'
      : '';

  // Ported from design/support.js's buildCase(): `nextAction` is the first
  // not-yet-done checklist item's label, falling back to "Review case".
  // `rowSubtext`/`actionColor` there duplicate the same
  // stalled-reason-or-next-action fallback in two separate row templates —
  // computed once here instead (nextActionLabel/rowSummaryText/Variant) so
  // Phase 5's two list components (AllCasesList, StageFilteredPanel) share
  // it rather than re-deriving it.
  const firstUndoneItem = currentChecklist.find((item) => !item.done);
  const nextActionLabel = firstUndoneItem?.label ?? 'Review case';
  const rowSummaryText = case_.isStalled ? (case_.stalledReason ?? '') : nextActionLabel;
  const rowSummaryVariant: 'danger' | 'neutral' = case_.isStalled ? 'danger' : 'neutral';

  // A stage the case has already moved beyond is complete by definition
  // (see domain/workflow/resolveChecklist.ts's doc comment) — determined
  // here from the case's own effective stage, not assumed from how the
  // caller (the StageStepper) happens to restrict which stages are
  // clickable.
  const viewedChecklist =
    viewingDisplayStage != null
      ? resolveChecklist(
          findStageByDisplayStage(snapshot, viewingDisplayStage)?.checklist.items ?? [],
          case_,
          { isPastStage: viewingDisplayStage < effectiveDisplayStage },
        )
      : currentChecklist;

  return {
    id: case_.id,
    decedentName: case_.decedentName,
    dateOfBirth: case_.dateOfBirth,
    dateOfDeath: case_.dateOfDeath,
    timeOfDeath: case_.timeOfDeath,
    placeOfDeath: case_.placeOfDeath,

    displayStage: effectiveDisplayStage,
    stageLabel,
    stageBadgeVariant: effectiveStage?.isAttentionStage ? 'danger' : 'neutral',

    ownerStaffId: case_.assignedStaffId,
    ownerName: owner.name,
    ownerInitials: owner.initials,
    effectiveOwnerName,

    weight: case_.weight,
    weightOver200: parseInt(case_.weight, 10) > 200,

    daysWaitingInStage: case_.daysWaitingInStage,
    slaTargetDays,
    slaTargetLabel: formatSlaTarget(slaTargetDays),
    isOverdue: isOverdue(slaTargetDays, case_.daysWaitingInStage, effectiveDisplayStage, snapshot),

    isStalled: case_.isStalled,
    stalledReason: case_.stalledReason,
    needsAttention,
    attentionReason,
    nextActionLabel,
    rowSummaryText,
    rowSummaryVariant,

    paymentStatus: case_.paymentStatus,
    paymentStatusVariant: case_.paymentStatus === 'paid_in_full' ? 'success' : 'brand',

    isVeteran: case_.isVeteran,
    veteranFlagLocked: isVeteranFlagLocked(case_.rawStage),
    vaSteps,
    vaAllStepsDone: VA_STEPS.every((_, index) => vaSteps[index]?.done ?? false),
    vaCallbackDone: isVaCallbackDone(case_),
    vaPublishChoice: case_.vaPublishChoice,
    vaComplete: isVaComplete(case_),

    checklist: viewedChecklist,
    viewingDisplayStage,

    timeline: buildTimeline(case_, currentChecklist, rawDisplayStage, effectiveOwnerName, snapshot),
    requiredDocuments: buildRequiredDocuments(case_.rawStage),

    // Ordered display-stage labels from the case's own snapshot — lets the
    // Case Detail page build its stepper/viewing-stage-label from real,
    // per-case template data instead of importing the hardcoded STAGES
    // constant (which only ever describes Managed Cremations' workflow).
    stageLabels: displayStagesInOrder(snapshot).map((stage) => stage.label),
  };
}

/**
 * Triage ordering for a case list — stalled cases first, then longest-waiting
 * first — ported from design/support.js's searchFilteredCases sort. This is
 * a business-meaningful prioritization rule (which cases most need eyes on),
 * not generic list plumbing, so it lives here rather than being inlined in
 * whichever page happens to render a case list first (currently the
 * Dashboard; Phase 6+ screens can reuse this same comparator).
 */
export function compareCasesByUrgency(a: CaseViewModel, b: CaseViewModel): number {
  return Number(b.isStalled) - Number(a.isStalled) || b.daysWaitingInStage - a.daysWaitingInStage;
}
