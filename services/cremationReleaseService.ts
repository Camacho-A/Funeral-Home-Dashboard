import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { servicePreparationFor } from '../domain/servicePreparation/serviceDefinitions';
import { selectServiceEvent, summarizeServiceReadiness } from '../domain/servicePreparation/readiness';
import crypto from 'crypto';
import {
  approvalSnapshotOf,
  buildCremationReleaseRecord,
  evaluateReleaseForCremation,
  RELEASE_FOR_CREMATION_AVAILABLE,
  RELEASE_FOR_CREMATION_UNAVAILABLE_REASON,
  ReleaseRefusedError,
  type ReleaseApprover,
  type ReleaseEvaluation,
} from '../domain/servicePreparation/releaseForCremation';
import { PreparationLimitError } from '../domain/servicePreparation/preparationUpdates';
import { appendReleaseEvent, correctableSignOffs, ReleaseTransitionError, RELEASE_STATUS_LABEL, type ReleaseStatus } from '../domain/servicePreparation/releaseHolds';
import { crematoryPaperworkMayHaveBeenSent } from '../domain/crematory/sentChecklistItems';
import type { ReleaseEvent, ServiceEvent, ServicePreparationDefinition, ServicePreparationRecord } from '../domain/servicePreparation/types';
import { buildCaseFieldPatch } from '../lib/wixCaseMapper';
import type { DataAdapterMode } from '../lib/env';
import type { Case, CaseUpdate } from '../types/case';
import { recordCremationRelease } from './activityService';
import { loadCaseRow, updateCaseWithRetry, writeMockCase } from './caseWriteService';
import { servicePreparationStorageAvailable } from './servicePreparationStorage';
import { getOrganization } from './organizationProvisioningService';
import { listAppointmentsForCase } from './scheduling/appointmentReads';
import { loadCaseOnServer } from './serverCaseLoader';
import { resolveStaffProfileForCaller } from './staffProfileService';
import { withCredentials } from './funeralDirectorCredentialService';

/**
 * Release for cremation on the server (Gus Phase 5F, 2026-11). Every
 * decision is made here, from the case, its appointment, the caller's own
 * staff profile and the organization's profile — never from anything the
 * browser says. Organization-scoped: another organization's case is not
 * found.
 *
 * `approveCremationRelease` (Phase 5K) records the release — but only when
 * RELEASE_FOR_CREMATION_AVAILABLE is on AND preparation may be saved in
 * this data mode (servicePreparationStorage.ts). Both are off today, so it
 * runs every check and then REFUSES (423): nothing is written, nothing is
 * sent, and Send to Crematory is unchanged.
 *
 * When on, the release is decided again from the case AS IT IS AT WRITE
 * TIME (a requirement that stopped being met in between refuses it), and
 * saved with its history entry in one revision-checked case write. An
 * unclear answer from Wix is settled by reading the case back — the event
 * id decides — never by a blind retry. Recording a release sends nothing.
 */
export class CremationReleaseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly evaluation: ReleaseEvaluation | null = null,
  ) {
    super(message);
  }
}

export type ReleaseCaller = { organizationId: string; userId: string; role: string };

const DEFAULT_TIME_ZONE = 'America/New_York';

type ReleaseContext = {
  case_: Case;
  definition: ServicePreparationDefinition;
  service: ServiceEvent | null;
  approver: ReleaseApprover;
  approverRoleKeys: readonly string[];
  operatorRoleKeys: readonly string[];
  licenseReverifyDays: number | null;
  timeZone: string;
};

async function loadReleaseContext(caller: ReleaseCaller, caseId: string, mode: DataAdapterMode): Promise<ReleaseContext | null> {
  const profile = getRegisteredOrganizationProfile(caller.organizationId);
  if (!profile.features.servicePreparation) return null;
  const case_ = await loadCaseOnServer(caller.organizationId, caseId, mode);
  if (!case_) return null;
  const definition = servicePreparationFor(case_.workflowSnapshot?.serviceTypeCode);
  if (!definition) return null;
  const [appointments, staffProfile, organization] = await Promise.all([
    listAppointmentsForCase(caller.organizationId, caseId, mode),
    resolveStaffProfileForCaller({ organizationId: caller.organizationId, userId: caller.userId, role: caller.role }, mode),
    getOrganization(caller.organizationId, mode).catch(() => null),
  ]);
  // Credentials come from their own store — never from the request.
  const approverProfile = staffProfile ? await withCredentials(staffProfile, mode) : null;
  return {
    case_,
    definition,
    service: selectServiceEvent(appointments, { organizationId: caller.organizationId, caseId, appointmentType: definition.serviceAppointmentType }),
    approver: { identityId: caller.userId, roleKey: caller.role, staffProfile: approverProfile },
    approverRoleKeys: profile.features.cremationReleaseApproverRoleKeys,
    operatorRoleKeys: profile.features.cremationReleaseOperatorRoleKeys,
    licenseReverifyDays: profile.features.funeralDirectorLicenseReverifyDays,
    timeZone: organization?.timezone ?? DEFAULT_TIME_ZONE,
  };
}

function recordOf(context: ReleaseContext, case_: Case): ServicePreparationRecord | null {
  return case_.servicePreparation && case_.servicePreparation.definitionKey === context.definition.key ? case_.servicePreparation : null;
}

function evaluateFor(context: ReleaseContext, case_: Case, now: string): ReleaseEvaluation {
  const { definition, service } = context;
  const record = recordOf(context, case_);
  return evaluateReleaseForCremation({
    case_,
    definition,
    readiness: summarizeServiceReadiness({ definition, record, service, now }),
    approver: context.approver,
    approverRoleKeys: context.approverRoleKeys,
    licenseReverifyDays: context.licenseReverifyDays,
    timeZone: context.timeZone,
    now,
  });
}

/** The evaluation for the person asking, with what they may do now and
    whether release actions are active on this site at all. */
export type CallerReleaseView = ReleaseEvaluation & { capabilities: ReleaseCapabilities; active: boolean };

export async function evaluateCremationReleaseForCaller(caller: ReleaseCaller, caseId: string, mode: DataAdapterMode, now = new Date().toISOString()): Promise<CallerReleaseView | null> {
  const context = await loadReleaseContext(caller, caseId, mode);
  if (!context) return null;
  const evaluation = evaluateFor(context, context.case_, now);
  const active = cremationReleaseRecordingAvailable(mode);
  const capabilities = releaseCapabilities(evaluation, caller.role, context.operatorRoleKeys, correctableSignOffs(recordOf(context, context.case_)).length > 0);
  // Release also needs preparation saving on this site.
  if (!active) return { ...evaluation, canRelease: false, unavailableReason: RELEASE_FOR_CREMATION_UNAVAILABLE_REASON, capabilities, active };
  return { ...evaluation, capabilities, active };
}

export type ReleaseAction = 'release' | 'sign_off' | 'hold' | 'reauthorize' | 'withdraw' | 'correct';

export const RELEASE_NOT_ACTIVE_MESSAGE = 'Release for cremation is not active yet. Nothing was released.';

/** Whether release actions may be recorded in this data mode. */
export function cremationReleaseRecordingAvailable(mode: DataAdapterMode): boolean {
  return RELEASE_FOR_CREMATION_AVAILABLE && servicePreparationStorageAvailable(mode);
}

const signerQualified = (evaluation: ReleaseEvaluation) =>
  evaluation.prerequisites.every((p) => (p.key !== 'approver_authorized' && p.key !== 'approver_licensed') || p.met);

/** What this caller may do now — shown on the card; the server decides again on every action. */
export type ReleaseCapabilities = {
  canRequestRelease: boolean;
  canSignOff: boolean;
  canHold: boolean;
  canReauthorize: boolean;
  canWithdraw: boolean;
  canCorrect: boolean;
  isOperator: boolean;
  isLicensedSigner: boolean;
};

export function releaseCapabilities(evaluation: ReleaseEvaluation, roleKey: string, operatorRoleKeys: readonly string[], hasCorrectableSignOff = false): ReleaseCapabilities {
  const isOperator = operatorRoleKeys.includes(roleKey);
  const isLicensedSigner = signerQualified(evaluation);
  const s = evaluation.status;
  return {
    isOperator,
    isLicensedSigner,
    canRequestRelease: (isOperator || isLicensedSigner) && s === 'not_released' && evaluation.casePrerequisitesMet,
    canSignOff: isLicensedSigner && (s === 'awaiting_signoff' || s === 'awaiting_reauthorization') && evaluation.allPrerequisitesMet,
    canHold: isOperator && (s === 'released' || s === 'reauthorized' || s === 'awaiting_reauthorization'),
    canReauthorize: (isOperator || isLicensedSigner) && s === 'on_hold' && evaluation.casePrerequisitesMet,
    canWithdraw: (isOperator || isLicensedSigner) && (s === 'awaiting_signoff' || s === 'awaiting_reauthorization'),
    canCorrect: isOperator && hasCorrectableSignOff,
  };
}

/**
 * The event this action records, decided from the evaluation of the case
 * as it is now — or the refusal. A licensed, authorized director with every
 * requirement met signs off in the same step; anyone else in the
 * operational roles records a request awaiting that sign-off.
 */
function decideEvent(
  action: ReleaseAction,
  evaluation: ReleaseEvaluation,
  context: ReleaseContext,
  current: Case,
  base: { eventId: string; now: string; actorName: string | null; reason: string | null; correctsEventId: string | null },
): ReleaseEvent {
  const correctable = correctableSignOffs(recordOf(context, current));
  const caps = releaseCapabilities(evaluation, context.approver.roleKey, context.operatorRoleKeys, correctable.length > 0);
  const status: ReleaseStatus = evaluation.status;
  const stamp = { eventId: base.eventId, at: base.now, actorId: context.approver.identityId, actorName: base.actorName, roleKey: context.approver.roleKey };
  const wrongState = () => new CremationReleaseError(`This can't be done while the release is "${RELEASE_STATUS_LABEL[status]}".`, 409, evaluation);
  const signOff = (type: 'released' | 'reauthorized'): ReleaseEvent => {
    if (!evaluation.allPrerequisitesMet) throw new CremationReleaseError('Not every requirement for release is met.', 409, evaluation);
    const release = buildCremationReleaseRecord({ case_: current, evaluation, approver: context.approver, approverRoleKeys: context.approverRoleKeys, serviceAppointmentId: context.service?.appointmentId ?? null, now: base.now });
    return { ...stamp, actorName: release.approvedBy.name, type, approval: approvalSnapshotOf(release) };
  };

  if (action === 'sign_off') {
    if (!caps.isLicensedSigner) throw new CremationReleaseError('Only an authorized Funeral Director with a verified license may sign off a release.', 403, evaluation);
    if (status === 'awaiting_signoff') return signOff('released');
    if (status === 'awaiting_reauthorization') return signOff('reauthorized');
    throw wrongState();
  }
  if (!caps.isOperator && !caps.isLicensedSigner) {
    throw new CremationReleaseError('Only an Administrator, Manager or Funeral Director may do this.', 403, evaluation);
  }
  if (action === 'hold') {
    if (!caps.isOperator) throw new CremationReleaseError('Only an Administrator, Manager or Funeral Director may place a hold.', 403, evaluation);
    if (!['released', 'reauthorized', 'awaiting_reauthorization'].includes(status)) throw wrongState();
    if (!base.reason?.trim()) throw new CremationReleaseError('Give a reason for the hold.', 400, evaluation);
    return { ...stamp, type: 'hold_placed', reason: base.reason, paperworkAlreadyTransmitted: crematoryPaperworkMayHaveBeenSent(current) };
  }
  if (action === 'withdraw') {
    if (status !== 'awaiting_signoff' && status !== 'awaiting_reauthorization') throw wrongState();
    return { ...stamp, type: 'request_withdrawn', reason: base.reason };
  }
  if (action === 'correct') {
    if (!caps.isOperator) throw new CremationReleaseError('Only an Administrator, Manager or Funeral Director may correct a recorded sign-off.', 403, evaluation);
    if (!base.reason?.trim()) throw new CremationReleaseError('Give a reason for the correction.', 400, evaluation);
    if (!correctable.some((e) => e.eventId === base.correctsEventId)) {
      throw new CremationReleaseError('Choose a recorded sign-off that has not already been corrected.', 409, evaluation);
    }
    return { ...stamp, type: 'release_corrected', reason: base.reason, correctsEventId: base.correctsEventId!, paperworkAlreadyTransmitted: crematoryPaperworkMayHaveBeenSent(current) };
  }
  const requested = action === 'release' ? 'release_requested' : 'reauthorization_requested';
  const signed = action === 'release' ? 'released' : 'reauthorized';
  if ((action === 'release' && status !== 'not_released') || (action === 'reauthorize' && status !== 'on_hold')) throw wrongState();
  if (!evaluation.casePrerequisitesMet) throw new CremationReleaseError('Not every requirement for release is met.', 409, evaluation);
  return caps.isLicensedSigner && evaluation.allPrerequisitesMet ? signOff(signed) : { ...stamp, type: requested };
}

export type ReleaseActionResult = { event: ReleaseEvent; status: ReleaseStatus; evaluation: ReleaseEvaluation; record: ServicePreparationRecord };

export async function performReleaseAction(
  caller: ReleaseCaller,
  caseId: string,
  mode: DataAdapterMode,
  input: { action: ReleaseAction; reason?: string | null; correctsEventId?: string | null; actorName?: string | null; now?: string; eventId?: string },
): Promise<ReleaseActionResult> {
  const now = input.now ?? new Date().toISOString();
  const context = await loadReleaseContext(caller, caseId, mode);
  if (!context) throw new CremationReleaseError('This case has no release for cremation.', 404);
  const actorName = input.actorName ?? context.approver.staffProfile?.displayName ?? null;
  const eventId = input.eventId ?? crypto.randomUUID();
  const base = { eventId, now, actorName, reason: input.reason ?? null, correctsEventId: input.correctsEventId ?? null };
  // Refuse early, before anything is written.
  decideEvent(input.action, evaluateFor(context, context.case_, now), context, context.case_, base);
  if (!cremationReleaseRecordingAvailable(mode)) throw new CremationReleaseError(RELEASE_NOT_ACTIVE_MESSAGE, 423, evaluateFor(context, context.case_, now));

  // Decided again from the case as it is at write time.
  const decide = (current: Case) => {
    if (current.isDeleted) throw new CremationReleaseError('This case is archived and read-only.', 409);
    if (current.servicePreparationUnreadable) {
      throw new CremationReleaseError("This case's saved preparation could not be read, so nothing was changed. Please contact SolisCode support.", 409);
    }
    const event = decideEvent(input.action, evaluateFor(context, current, now), context, current, base);
    const previous = current.servicePreparation && current.servicePreparation.definitionKey === context.definition.key ? current.servicePreparation : null;
    return appendReleaseEvent({ definition: context.definition, record: previous, event });
  };
  const savedHere = (case_: Case | null | undefined) => Boolean(case_?.servicePreparation?.releaseEvents?.some((e) => e.eventId === eventId));
  const isDecision = (error: unknown) =>
    error instanceof CremationReleaseError || error instanceof ReleaseRefusedError || error instanceof ReleaseTransitionError || error instanceof PreparationLimitError;

  let saved: Case | null;
  try {
    if (mode === 'mock') {
      saved = writeMockCase(caller.organizationId, caseId, (current) => ({ ...current, servicePreparation: decide(current) }));
    } else {
      let outcome: Awaited<ReturnType<typeof updateCaseWithRetry>> | { result: 'unclear' };
      try {
        outcome = await updateCaseWithRetry(caller.organizationId, caseId, (row) => buildCaseFieldPatch(row.data, { servicePreparation: decide(row.case_) } as CaseUpdate));
      } catch (error) {
        if (isDecision(error)) throw error;
        console.error(`Release action on case ${caseId}: no clear answer from Wix:`, error instanceof Error ? error.message : error);
        outcome = { result: 'unclear' };
      }
      if (outcome.result === 'conflict') throw new CremationReleaseError('The case changed while this was being saved. Nothing was changed — please check it and try again.', 409);
      if (outcome.result === 'failed' || outcome.result === 'unclear') {
        const readBack = await loadCaseRow(caller.organizationId, caseId).catch(() => undefined);
        if (readBack === undefined) throw new CremationReleaseError('SOLIS could not confirm whether this was saved. Refresh the case and check it before trying again.', 503);
        if (!savedHere(readBack?.case_)) throw new CremationReleaseError('This was not saved. Please try again.', 503);
        saved = readBack!.case_;
      } else {
        saved = outcome.result === 'not_found' ? null : outcome.case_;
      }
    }
  } catch (error) {
    if (error instanceof ReleaseRefusedError || error instanceof ReleaseTransitionError) throw new CremationReleaseError(error.message, 409);
    if (error instanceof PreparationLimitError) throw new CremationReleaseError(error.message, 413);
    throw error;
  }
  if (!saved) throw new CremationReleaseError('This case has no release for cremation.', 404);
  const record = saved.servicePreparation;
  const event = record?.releaseEvents?.find((e) => e.eventId === eventId);
  if (!record || !event) throw new CremationReleaseError('This was not saved. Please check the case and try again.', 409);

  try {
    const entry = record.history?.find((e) => e.eventId === eventId);
    await recordCremationRelease(
      { organizationId: caller.organizationId, actorIdentityId: caller.userId, actorMembershipId: null, actorRoleKey: caller.role, correlationId: eventId },
      caseId,
      { description: entry?.description ?? event.type, release: event as unknown as Record<string, unknown>, workflowUpdate: event.type !== 'released' },
      mode,
    );
  } catch (error) {
    console.error(`Activity event for release action ${eventId} on case ${caseId} was not recorded; it is saved in the case's history:`, error instanceof Error ? error.message : error);
  }
  const evaluation = evaluateFor(context, saved, now);
  return { event, status: evaluation.status, evaluation, record };
}

/** Release (or request release). Kept for callers of Phase 5K. */
export async function approveCremationRelease(caller: ReleaseCaller, caseId: string, mode: DataAdapterMode, options: { now?: string; eventId?: string } = {}) {
  const result = await performReleaseAction(caller, caseId, mode, { action: 'release', ...options });
  return { ...result, release: result.record.release ?? null };
}
