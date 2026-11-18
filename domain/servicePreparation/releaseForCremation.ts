import { CREMATION_STEPS } from '../workflow/cremationFoundation';
import { findStep } from '../workflow/workflowSteps';
import { readChecklistValue } from '../workflow/checklistItemKey';
import { checkFuneralDirectorLicense } from '../staff/funeralDirectorLicense';
import type { Case } from '../../types/case';
import type { StaffProfile } from '../../types/staffProfile';
import type { ServiceReadiness } from './readiness';
import type { ServicePreparationDefinition } from './types';

/**
 * Release for cremation (Gus Phase 5F, 2026-11).
 *
 * When cremation waits for a service (Viewing, Final Goodbye), the
 * cremation paperwork is released to the crematory only when EVERY
 * prerequisite below is met, and only by a verified, authorized funeral
 * director. Each is checked on its own — no single fact unlocks release:
 *
 *   the service itself     — the scheduled service is marked completed
 *   cremation authorization — the arrangement form (authorization) step
 *   EDRS                   — submitted, cause of death, attestation
 *   medical examiner        — an explicit ME cremation approval (SOLIS has
 *                            no record of it yet, so this is never met)
 *   state permit           — confirmed on the case (necessary, never enough)
 *   48 hours since death   — Florida §872.03
 *   identification         — checked on the remains on the service day
 *   service-specific       — Viewing: embalming authorization signed
 *   approver               — role allowed by the organization AND a
 *                            verified funeral director license
 *
 * Telling the crematory about the service (a preparation item) is NOT a
 * release and is not a prerequisite of one.
 *
 * NOT ACTIVE. RELEASE_FOR_CREMATION_AVAILABLE is false: even with every
 * prerequisite met, nothing is released and Send to Crematory is
 * unchanged. The rules are implemented and tested so they can be switched
 * on separately, once the data they need is stored (license, ME approval,
 * release record).
 */
export const RELEASE_FOR_CREMATION_AVAILABLE = false;
export const RELEASE_FOR_CREMATION_UNAVAILABLE_REASON =
  'Release for cremation is not active yet. The requirements above are checked, but nothing is released from here and sending to the crematory is unchanged.';

export type ReleasePrerequisiteKey =
  | 'service_completed'
  | 'cremation_authorization'
  | 'edrs_complete'
  | 'medical_examiner_approval'
  | 'state_permit'
  | 'forty_eight_hours'
  | 'identification'
  | 'service_specific'
  | 'approver_authorized'
  | 'approver_licensed';

export type ReleasePrerequisite = { key: ReleasePrerequisiteKey; label: string; met: boolean; detail?: string };

export type ReleaseEvaluation = {
  applies: boolean | 'undecided';
  released: boolean;
  prerequisites: ReleasePrerequisite[];
  /** Every prerequisite met — what release WOULD allow once active. */
  allPrerequisitesMet: boolean;
  canRelease: boolean;
  unavailableReason: string | null;
};

export type ReleaseApprover = {
  identityId: string;
  roleKey: string;
  staffProfile: (Pick<StaffProfile, 'id' | 'identityId' | 'organizationId' | 'isActive' | 'displayName'> & { funeralDirectorLicense?: StaffProfile['funeralDirectorLicense'] }) | null;
};

const HOUR = 60 * 60 * 1000;

function stepDone(case_: Case, stepId: string): boolean {
  const at = findStep(case_.workflowSnapshot?.stages, stepId);
  return Boolean(at) && readChecklistValue(case_.checklistState ?? {}, at!.displayStage, at!.index) === true;
}

/** Offset of `timeZone` from UTC at `utcMs`, in ms. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs;
}

/** When death occurred, as an instant, or null when the case does not say.
    A missing time counts as the END of that day — the later, safer guess. */
export function deathInstant(dateOfDeath: string, timeOfDeath: string, timeZone: string): number | null {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateOfDeath?.trim() ?? '');
  if (!d) return null;
  let hour = 23;
  let minute = 59;
  const t = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(timeOfDeath?.trim() ?? '');
  if (t) {
    hour = Number(t[1]) % (t[3] ? 12 : 24) + (t[3]?.toUpperCase() === 'PM' ? 12 : 0);
    minute = Number(t[2]);
  }
  const guess = Date.UTC(Number(d[3]), Number(d[1]) - 1, Number(d[2]), hour, minute);
  return guess - zoneOffset(guess, timeZone);
}

export function evaluateReleaseForCremation(params: {
  case_: Case;
  definition: ServicePreparationDefinition;
  readiness: ServiceReadiness;
  /** null when evaluated for display without a signed-in approver. */
  approver: ReleaseApprover | null;
  /** Role keys the organization allows to release (profile). */
  approverRoleKeys: readonly string[];
  timeZone: string;
  now: string;
  /** Whether an explicit medical examiner cremation approval is recorded.
      SOLIS has nowhere to record one yet, so every caller passes false
      (the default); it exists so the rule is ready when that data is. */
  medicalExaminerApprovalRecorded?: boolean;
}): ReleaseEvaluation {
  const { case_, readiness, definition, approver } = params;
  const prepDone = (id: string) => readiness.items.find((i) => i.id === id)?.done === true;
  const death = deathInstant(case_.dateOfDeath, case_.timeOfDeath, params.timeZone);
  const hours = death === null ? null : (Date.parse(params.now) - death) / HOUR;
  const license = approver?.staffProfile
    ? checkFuneralDirectorLicense(approver.staffProfile, { organizationId: case_.organizationId, today: params.now.slice(0, 10), now: params.now })
    : { verified: false, problems: ['No staff profile for this person.'] };
  const serviceSpecific = definition.releasePrerequisiteItems ?? [];

  const prerequisites: ReleasePrerequisite[] = [
    { key: 'service_completed', label: `${readiness.serviceName} marked completed`, met: readiness.service?.status === 'completed' },
    { key: 'cremation_authorization', label: 'Cremation authorization (arrangement form) completed', met: stepDone(case_, CREMATION_STEPS.arrangementFormCompleted) },
    {
      key: 'edrs_complete',
      label: 'EDRS submitted, cause of death and attestation entered',
      met: stepDone(case_, CREMATION_STEPS.edrsSubmitted) && stepDone(case_, CREMATION_STEPS.causeOfDeath) && stepDone(case_, CREMATION_STEPS.attestation),
    },
    {
      key: 'medical_examiner_approval',
      label: 'Medical examiner cremation approval recorded',
      met: params.medicalExaminerApprovalRecorded === true,
      ...(params.medicalExaminerApprovalRecorded ? {} : { detail: 'SOLIS does not record this approval yet.' }),
    },
    { key: 'state_permit', label: 'State burial-transit permit confirmed on the case', met: Boolean(case_.crematory?.permitVerification) },
    {
      key: 'forty_eight_hours',
      label: 'At least 48 hours since death',
      met: hours !== null && hours >= 48,
      ...(hours === null ? { detail: 'Date of death is missing.' } : {}),
    },
    { key: 'identification', label: 'Identification checked on the remains', met: prepDone('prep.day_of.identification_verified') },
    ...(serviceSpecific.length
      ? [{ key: 'service_specific' as const, label: serviceSpecific.map((s) => s.label).join('; '), met: serviceSpecific.every((s) => prepDone(s.itemId)) }]
      : []),
    {
      key: 'approver_authorized',
      label: 'Approved by staff the funeral home allows to release',
      met: Boolean(approver) && params.approverRoleKeys.includes(approver!.roleKey) && approver!.staffProfile?.organizationId === case_.organizationId && approver!.staffProfile?.identityId === approver!.identityId,
    },
    { key: 'approver_licensed', label: 'Approver is a verified, licensed funeral director', met: license.verified, ...(license.verified ? {} : { detail: license.problems.join(' ') }) },
  ];

  const released = Boolean(case_.servicePreparation?.release);
  const allPrerequisitesMet = readiness.holdsCremation === true && prerequisites.every((p) => p.met);
  return {
    applies: readiness.holdsCremation,
    released,
    prerequisites,
    allPrerequisitesMet,
    canRelease: RELEASE_FOR_CREMATION_AVAILABLE && allPrerequisitesMet && !released,
    unavailableReason: RELEASE_FOR_CREMATION_AVAILABLE ? null : RELEASE_FOR_CREMATION_UNAVAILABLE_REASON,
  };
}

/** What a release WILL record once active: the approving director, the
    case, the time and every satisfied prerequisite. Refuses unless every
    prerequisite is met. */
export type CremationReleaseRecord = {
  caseId: string;
  organizationId: string;
  serviceAppointmentId: string | null;
  approvedAt: string;
  approvedBy: { identityId: string; staffProfileId: string; name: string; roleKey: string; licenseNumber: string; licenseState: string; licenseExpiresOn: string };
  prerequisites: { key: ReleasePrerequisiteKey; label: string }[];
};

export function buildCremationReleaseRecord(params: { case_: Case; evaluation: ReleaseEvaluation; approver: ReleaseApprover; serviceAppointmentId: string | null; now: string }): CremationReleaseRecord {
  const { evaluation, approver } = params;
  const license = approver.staffProfile?.funeralDirectorLicense;
  if (!evaluation.allPrerequisitesMet || !approver.staffProfile || !license) {
    throw new Error('Release refused: not every prerequisite is met.');
  }
  return {
    caseId: params.case_.id,
    organizationId: params.case_.organizationId,
    serviceAppointmentId: params.serviceAppointmentId,
    approvedAt: params.now,
    approvedBy: {
      identityId: approver.identityId,
      staffProfileId: approver.staffProfile.id,
      name: approver.staffProfile.displayName,
      roleKey: approver.roleKey,
      licenseNumber: license.licenseNumber,
      licenseState: license.state,
      licenseExpiresOn: license.expiresOn,
    },
    prerequisites: evaluation.prerequisites.map((p) => ({ key: p.key, label: p.label })),
  };
}
