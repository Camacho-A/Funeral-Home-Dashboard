import type { Case } from '../../types/case';
import type { StaffProfile } from '../../types/staffProfile';
import type { CaseViewModel, RequiredDocumentViewModel } from '../../types/caseViewModel';
import { isBottleneckStage, toDisplayStage, toRawStage } from './stages';
import { buildChecklist } from './checklist';
import { resolveEffectiveDisplayStage, stageLabelFor } from './transitions';
import { getSlaTargetDays, formatSlaTarget, isOverdue } from './sla';
import {
  buildVaSteps,
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
 * service dependency.
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

export function buildCaseViewModel(case_: Case, context: CaseViewModelContext): CaseViewModel {
  const { staffList, viewingDisplayStage = null } = context;

  const rawDisplayStage = toDisplayStage(case_.rawStage);
  const currentChecklist = buildChecklist(case_, case_.rawStage);
  const effectiveDisplayStage = resolveEffectiveDisplayStage(rawDisplayStage, currentChecklist);
  const stageLabel = stageLabelFor(effectiveDisplayStage);

  const owner = resolveOwner(case_, staffList);
  const slaTargetDays = getSlaTargetDays(effectiveDisplayStage);
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

  const viewedChecklist =
    viewingDisplayStage != null
      ? buildChecklist(case_, toRawStage(viewingDisplayStage))
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
    stageBadgeVariant: isBottleneckStage(effectiveDisplayStage) ? 'danger' : 'neutral',

    ownerStaffId: case_.assignedStaffId,
    ownerName: owner.name,
    ownerInitials: owner.initials,

    weight: case_.weight,
    weightOver200: parseInt(case_.weight, 10) > 200,

    daysWaitingInStage: case_.daysWaitingInStage,
    slaTargetDays,
    slaTargetLabel: formatSlaTarget(slaTargetDays),
    isOverdue: isOverdue(effectiveDisplayStage, case_.daysWaitingInStage),

    isStalled: case_.isStalled,
    stalledReason: case_.stalledReason,
    needsAttention,
    attentionReason,

    paymentStatus: case_.paymentStatus,
    paymentStatusVariant: case_.paymentStatus === 'paid_in_full' ? 'success' : 'brand',

    isVeteran: case_.isVeteran,
    veteranFlagLocked: isVeteranFlagLocked(case_.rawStage),
    vaSteps,
    vaAllStepsDone: VA_STEPS.every((_, index) => vaSteps[index]?.done ?? false),
    vaPublishChoice: case_.vaPublishChoice,
    vaComplete: isVaComplete(case_),

    checklist: viewedChecklist,
    viewingDisplayStage,

    timeline: buildTimeline(
      case_,
      currentChecklist,
      rawDisplayStage,
      owner.name === '—' ? 'Office' : owner.name,
    ),
    requiredDocuments: buildRequiredDocuments(case_.rawStage),
  };
}
