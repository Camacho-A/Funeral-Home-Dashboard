import { CREMATION_STEPS } from '../../domain/workflow/cremationFoundation';
import { findStep } from '../../domain/workflow/workflowSteps';
import { checklistItemKey } from '../../domain/workflow/checklistItemKey';
import { VIEWING_PREPARATION } from '../../domain/servicePreparation/serviceDefinitions';
import { applyPreparationChange } from '../../domain/servicePreparation/preparationUpdates';
import type { Appointment } from '../../types/appointment';
import type { Case } from '../../types/case';

/**
 * Fictional data for release-for-cremation tests (Gus Phase 5K): a Viewing
 * case on which every requirement for release is met, relative to `now`.
 */
const DAY = 24 * 60 * 60 * 1000;

export const usCaseDate = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

/** The Viewing, held yesterday and marked completed. */
export function completedViewingAppointment(organizationId: string, caseId: string, now: string): Appointment {
  const at = Date.parse(now);
  return {
    id: 'appt-viewing',
    organizationId,
    caseId,
    appointmentType: 'viewing',
    status: 'completed',
    startAt: new Date(at - DAY).toISOString(),
    endAt: new Date(at - DAY + 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(at - 4 * DAY).toISOString(),
  } as Appointment;
}

/** `base` (a Viewing case) with every legal step, the ME approval, the
    permit, identification and the embalming authorization done. */
export function releaseReadyViewingCase(base: Case, now: string, overrides: Partial<Case> = {}): Case {
  const stages = base.workflowSnapshot!.stages;
  const checklistState: Record<string, boolean> = { ...base.checklistState };
  for (const stepId of [CREMATION_STEPS.arrangementFormCompleted, CREMATION_STEPS.edrsSubmitted, CREMATION_STEPS.causeOfDeath, CREMATION_STEPS.attestation]) {
    const at = findStep(stages, stepId)!;
    checklistState[checklistItemKey(at.displayStage, at.index)] = true;
  }
  const appointment = completedViewingAppointment(base.organizationId, base.id, now);
  const service = { appointmentId: appointment.id, startAt: appointment.startAt, endAt: appointment.endAt, status: 'completed' as const, bookedAt: appointment.createdAt };
  let record: Case['servicePreparation'] = null;
  ['prep.day_of.identification_verified', 'prep.embalming.written_permission'].forEach((itemId, n) => {
    record = applyPreparationChange({
      definition: VIEWING_PREPARATION,
      record: record ?? null,
      service,
      change: { kind: 'item', itemId, status: 'completed' },
      actor: { id: 'identity-gus-admin', name: 'Avery Demo' },
      now,
      eventId: `prep-${n}`,
    });
  });
  return {
    ...base,
    dateOfDeath: usCaseDate(Date.parse(now) - 5 * DAY),
    timeOfDeath: '09:00',
    checklistState,
    servicePreparation: record,
    crematory: {
      ...base.crematory,
      permitVerification: { documentId: 'doc-permit', checksumSha256: 'fictional', verifiedBy: 'identity-gus-admin', verifiedAt: now },
      medicalExaminerApproval: {
        confirmedInEdrs: true,
        approvalDate: new Date(Date.parse(now) - 3 * DAY).toISOString().slice(0, 10),
        reference: 'EDRS-FICTIONAL-1001',
        evidence: { documentId: null, source: 'EDRS case status screen (fictional)' },
        recordedBy: 'identity-gus-director',
        recordedByName: 'Jordan Demo',
        recordedAt: now,
        eventId: 'me-fictional-1',
      },
    },
    ...overrides,
  } as Case;
}
