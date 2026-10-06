import type { Case } from '../../types/case';
import { toDisplayStage, STAGES } from '../cases/stages';
import { presentedStageLabels, toPresentedStageIndex } from '../organization/workflowStagePresentation';

/**
 * Phase 29 (Family Portal & External Collaboration). An explicit
 * allowlisting DTO — the family-facing shape of a `Case`, gated by
 * `case.summary.read`. Never a raw `Case`: this excludes every
 * internal/operational field (`assignedStaffId`, `rawStage`,
 * `checklistState`, `fieldValues`, `vaStepsState`/`vaPublishChoice`,
 * `createdBy`/`intakeOwnerId`, `isStalled`/`stalledReason`/
 * `daysWaitingInStage`, `workflowSnapshot`/`workflowTemplateId`, and
 * `paymentStatus` — the last belongs to `portalPaymentView.ts` instead,
 * never duplicated here).
 */
export type PortalCaseView = {
  id: string;
  caseNumber: string;
  decedentName: string;
  dateOfBirth: string;
  dateOfDeath: string;
  /** A human-readable stage label (`domain/cases/stages.ts`'s own
      `STAGES` array) — never the raw `rawStage` number, which is an
      internal implementation detail of the staff workflow model. */
  stageLabel: string;
  caseType: string;
};

export function buildPortalCaseView(caseRecord: Case): PortalCaseView {
  return {
    id: caseRecord.id,
    caseNumber: caseRecord.caseNumber,
    decedentName: caseRecord.decedentName,
    dateOfBirth: caseRecord.dateOfBirth,
    dateOfDeath: caseRecord.dateOfDeath,
    // Manors intake-stage combination (2026-10): families see the same
    // user-facing stage name staff do, so the two surfaces never disagree
    // about what stage a case is in. Presentation only — `rawStage` is
    // untouched. See domain/organization/workflowStagePresentation.ts.
    stageLabel:
      presentedStageLabels(caseRecord.organizationId, STAGES)[
        toPresentedStageIndex(caseRecord.organizationId, toDisplayStage(caseRecord.rawStage), STAGES)
      ] ?? STAGES[toDisplayStage(caseRecord.rawStage)],
    caseType: caseRecord.caseType,
  };
}
