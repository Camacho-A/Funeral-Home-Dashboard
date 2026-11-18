import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { servicePreparationFor } from '../domain/servicePreparation/serviceDefinitions';
import { selectServiceEvent, summarizeServiceReadiness } from '../domain/servicePreparation/readiness';
import { evaluateReleaseForCremation, RELEASE_FOR_CREMATION_AVAILABLE, type ReleaseEvaluation } from '../domain/servicePreparation/releaseForCremation';
import type { DataAdapterMode } from '../lib/env';
import { getOrganization } from './organizationProvisioningService';
import { listAppointmentsForCase } from './scheduling/appointmentReads';
import { loadCaseOnServer } from './serverCaseLoader';
import { resolveStaffProfileForCaller } from './staffProfileService';

/**
 * Release for cremation on the server (Gus Phase 5F, 2026-11). Every
 * decision is made here, from the case, its appointment, the caller's own
 * staff profile and the organization's profile — never from anything the
 * browser says. Organization-scoped: another organization's case is not
 * found.
 *
 * `approveCremationRelease` runs every check and then REFUSES — release is
 * not active (RELEASE_FOR_CREMATION_AVAILABLE is false). Nothing is
 * written, nothing is sent, and Send to Crematory is unchanged.
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

export async function evaluateCremationReleaseForCaller(caller: ReleaseCaller, caseId: string, mode: DataAdapterMode, now = new Date().toISOString()): Promise<ReleaseEvaluation | null> {
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
  const service = selectServiceEvent(appointments, { organizationId: caller.organizationId, caseId, appointmentType: definition.serviceAppointmentType });
  const record = case_.servicePreparation && case_.servicePreparation.definitionKey === definition.key ? case_.servicePreparation : null;
  const readiness = summarizeServiceReadiness({ definition, record, service, now });
  return evaluateReleaseForCremation({
    case_,
    definition,
    readiness,
    approver: { identityId: caller.userId, roleKey: caller.role, staffProfile },
    approverRoleKeys: profile.features.cremationReleaseApproverRoleKeys,
    timeZone: organization?.timezone ?? DEFAULT_TIME_ZONE,
    now,
  });
}

export async function approveCremationRelease(caller: ReleaseCaller, caseId: string, mode: DataAdapterMode, now = new Date().toISOString()): Promise<never> {
  const evaluation = await evaluateCremationReleaseForCaller(caller, caseId, mode, now);
  if (!evaluation) throw new CremationReleaseError('This case has no release for cremation.', 404);
  const approverProblems = evaluation.prerequisites.filter((p) => (p.key === 'approver_authorized' || p.key === 'approver_licensed') && !p.met);
  if (approverProblems.length > 0) throw new CremationReleaseError('Only a verified, licensed funeral director the funeral home allows may release for cremation.', 403, evaluation);
  if (evaluation.released) throw new CremationReleaseError('Already released for cremation.', 409, evaluation);
  if (!evaluation.allPrerequisitesMet) throw new CremationReleaseError('Not every requirement for release is met.', 409, evaluation);
  if (!RELEASE_FOR_CREMATION_AVAILABLE) throw new CremationReleaseError('Release for cremation is not active yet. Nothing was released.', 423, evaluation);
  // Activation (a separate, approved phase) records buildCremationReleaseRecord here.
  throw new CremationReleaseError('Release for cremation is not active yet. Nothing was released.', 423, evaluation);
}
