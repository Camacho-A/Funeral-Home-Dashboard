import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { servicePreparationFor } from '../domain/servicePreparation/serviceDefinitions';
import { selectServiceEvent, summarizeServiceReadiness } from '../domain/servicePreparation/readiness';
import crypto from 'crypto';
import {
  applyCremationRelease,
  buildCremationReleaseRecord,
  evaluateReleaseForCremation,
  RELEASE_FOR_CREMATION_AVAILABLE,
  RELEASE_FOR_CREMATION_UNAVAILABLE_REASON,
  ReleaseRefusedError,
  type ReleaseApprover,
  type ReleaseEvaluation,
} from '../domain/servicePreparation/releaseForCremation';
import { PreparationLimitError } from '../domain/servicePreparation/preparationUpdates';
import type { ReleaseForCremationRecord, ServiceEvent, ServicePreparationDefinition } from '../domain/servicePreparation/types';
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
    licenseReverifyDays: profile.features.funeralDirectorLicenseReverifyDays,
    timeZone: organization?.timezone ?? DEFAULT_TIME_ZONE,
  };
}

function evaluateFor(context: ReleaseContext, case_: Case, now: string): ReleaseEvaluation {
  const { definition, service } = context;
  const record = case_.servicePreparation && case_.servicePreparation.definitionKey === definition.key ? case_.servicePreparation : null;
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

export async function evaluateCremationReleaseForCaller(caller: ReleaseCaller, caseId: string, mode: DataAdapterMode, now = new Date().toISOString()): Promise<ReleaseEvaluation | null> {
  const context = await loadReleaseContext(caller, caseId, mode);
  if (!context) return null;
  const evaluation = evaluateFor(context, context.case_, now);
  // Release also needs preparation saving on this site.
  if (evaluation.canRelease && !cremationReleaseRecordingAvailable(mode)) {
    return { ...evaluation, canRelease: false, unavailableReason: RELEASE_FOR_CREMATION_UNAVAILABLE_REASON };
  }
  return evaluation;
}

/** The refusal, if any, for this evaluation — the approver first, so a
    non-director learns only that they may not release. */
function refusalFor(evaluation: ReleaseEvaluation): CremationReleaseError | null {
  const approverProblems = evaluation.prerequisites.filter((p) => (p.key === 'approver_authorized' || p.key === 'approver_licensed') && !p.met);
  if (approverProblems.length > 0) return new CremationReleaseError('Only an authorized Funeral Director with a verified license may release for cremation.', 403, evaluation);
  if (evaluation.released) return new CremationReleaseError('Already released for cremation.', 409, evaluation);
  if (!evaluation.allPrerequisitesMet) return new CremationReleaseError('Not every requirement for release is met.', 409, evaluation);
  return null;
}

export const RELEASE_NOT_ACTIVE_MESSAGE = 'Release for cremation is not active yet. Nothing was released.';

/** Whether a release may be recorded in this data mode. */
export function cremationReleaseRecordingAvailable(mode: DataAdapterMode): boolean {
  return RELEASE_FOR_CREMATION_AVAILABLE && servicePreparationStorageAvailable(mode);
}

export async function approveCremationRelease(
  caller: ReleaseCaller,
  caseId: string,
  mode: DataAdapterMode,
  options: { now?: string; eventId?: string } = {},
): Promise<{ release: ReleaseForCremationRecord; evaluation: ReleaseEvaluation }> {
  const now = options.now ?? new Date().toISOString();
  const context = await loadReleaseContext(caller, caseId, mode);
  if (!context) throw new CremationReleaseError('This case has no release for cremation.', 404);
  const first = evaluateFor(context, context.case_, now);
  const refusal = refusalFor(first);
  if (refusal) throw refusal;
  if (!cremationReleaseRecordingAvailable(mode)) throw new CremationReleaseError(RELEASE_NOT_ACTIVE_MESSAGE, 423, first);

  const eventId = options.eventId ?? crypto.randomUUID();
  // Decided again from the case as it is at write time.
  const decide = (current: Case) => {
    if (current.isDeleted) throw new CremationReleaseError('This case is archived and read-only.', 409);
    if (current.servicePreparationUnreadable) {
      throw new CremationReleaseError("This case's saved preparation could not be read, so nothing was released. Please contact SolisCode support.", 409);
    }
    const evaluation = evaluateFor(context, current, now);
    const refused = refusalFor(evaluation);
    if (refused) throw refused;
    const release = buildCremationReleaseRecord({
      case_: current,
      evaluation,
      approver: context.approver,
      approverRoleKeys: context.approverRoleKeys,
      serviceAppointmentId: context.service?.appointmentId ?? null,
      now,
    });
    const previous = current.servicePreparation && current.servicePreparation.definitionKey === context.definition.key ? current.servicePreparation : null;
    return applyCremationRelease({ definition: context.definition, record: previous, release, eventId });
  };
  const releasedHere = (case_: Case | null | undefined) => case_?.servicePreparation?.release?.eventId === eventId;
  const isDecision = (error: unknown) => error instanceof CremationReleaseError || error instanceof ReleaseRefusedError || error instanceof PreparationLimitError;

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
        console.error(`Release for case ${caseId}: no clear answer from Wix:`, error instanceof Error ? error.message : error);
        outcome = { result: 'unclear' };
      }
      if (outcome.result === 'conflict') throw new CremationReleaseError('The case changed while this was being saved. Nothing was released — please check it and try again.', 409);
      if (outcome.result === 'failed' || outcome.result === 'unclear') {
        const readBack = await loadCaseRow(caller.organizationId, caseId).catch(() => undefined);
        if (readBack === undefined) throw new CremationReleaseError('SOLIS could not confirm whether the release was saved. Refresh the case and check it before trying again.', 503);
        if (!releasedHere(readBack?.case_)) throw new CremationReleaseError('The release was not saved. Please try again.', 503);
        saved = readBack!.case_;
      } else {
        saved = outcome.result === 'not_found' ? null : outcome.case_;
      }
    }
  } catch (error) {
    if (error instanceof ReleaseRefusedError) throw new CremationReleaseError(error.message, 409);
    if (error instanceof PreparationLimitError) throw new CremationReleaseError(error.message, 413);
    throw error;
  }
  const release = saved?.servicePreparation?.release;
  if (!saved) throw new CremationReleaseError('This case has no release for cremation.', 404);
  if (!release || release.eventId !== eventId) throw new CremationReleaseError('The release was not saved. Please check the case and try again.', 409);

  try {
    const entry = saved.servicePreparation?.history?.find((e) => e.eventId === eventId);
    await recordCremationRelease(
      { organizationId: caller.organizationId, actorIdentityId: caller.userId, actorMembershipId: null, actorRoleKey: caller.role, correlationId: eventId },
      caseId,
      { description: entry?.description ?? 'Released for cremation', release: release as unknown as Record<string, unknown> },
      mode,
    );
  } catch (error) {
    console.error(`Activity event for release ${eventId} on case ${caseId} was not recorded; the release and its history entry are saved on the case:`, error instanceof Error ? error.message : error);
  }
  return { release, evaluation: evaluateFor(context, saved, now) };
}
