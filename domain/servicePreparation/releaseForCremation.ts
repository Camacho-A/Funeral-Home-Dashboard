import { CREMATION_STEPS } from '../workflow/cremationFoundation';
import { findStep } from '../workflow/workflowSteps';
import { readChecklistValue } from '../workflow/checklistItemKey';
import { checkFuneralDirectorLicense } from '../staff/funeralDirectorLicense';
import { checkMedicalExaminerApproval } from '../crematory/medicalExaminerApproval';
import type { Case } from '../../types/case';
import type { StaffProfile } from '../../types/staffProfile';
import { serviceHoldsCremation, type ServiceReadiness } from './readiness';
import { servicePreparationFor } from './serviceDefinitions';
import { appendReleaseEvent, currentHold, isReleasedStatus, releaseStatusOf, type ReleaseStatus } from './releaseHolds';
import type { ReleaseApprovalSnapshot, ReleaseEvent, ServicePreparationDefinition, ServicePreparationRecord } from './types';

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
 *   medical examiner        — a valid ME cremation approval recorded on the
 *                            case's crematory record (Phase 5G) — never
 *                            inferred from the permit, EDRS ticks or the ME
 *                            jurisdiction flag
 *   state permit           — confirmed on the case (necessary, never enough)
 *   48 hours since death   — Florida §872.03
 *   identification         — checked on the remains on the service day
 *   service-specific       — Viewing: embalming authorization signed
 *   approver               — a Funeral Director: the organization's
 *                            Funeral Director role, or (for anyone else,
 *                            an administrator included) an explicit
 *                            authorization granted by someone else — AND,
 *                            either way, a verified license. An
 *                            administrator role alone never qualifies.
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
  /** Released and not on hold. */
  released: boolean;
  /** Where the release-hold workflow stands (releaseHolds.ts). */
  status: ReleaseStatus;
  /** The hold in force, if any. */
  hold: { reason: string | null; at: string; byName: string | null; paperworkAlreadyTransmitted: boolean } | null;
  /** Every requirement except who approves (the approver checks). */
  casePrerequisitesMet: boolean;
  prerequisites: ReleasePrerequisite[];
  /** Every prerequisite met — what release WOULD allow once active. */
  allPrerequisitesMet: boolean;
  canRelease: boolean;
  unavailableReason: string | null;
};

export type ReleaseApprover = {
  identityId: string;
  roleKey: string;
  staffProfile:
    | (Pick<StaffProfile, 'id' | 'identityId' | 'organizationId' | 'isActive' | 'displayName'> & {
        funeralDirectorLicense?: StaffProfile['funeralDirectorLicense'];
        funeralDirectorAuthorization?: StaffProfile['funeralDirectorAuthorization'];
      })
    | null;
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

/** Is this person an authorized Funeral Director for the case's
    organization? Their own profile, in that organization, and either the
    Funeral Director role or an explicit authorization someone ELSE granted. */
export function approverAuthorization(
  approver: ReleaseApprover,
  organizationId: string,
  funeralDirectorRoleKeys: readonly string[],
): { ok: boolean; detail: string; basis?: ReleaseApprovalSnapshot['basis'] } {
  const profile = approver.staffProfile;
  if (!profile || profile.organizationId !== organizationId || profile.identityId !== approver.identityId) {
    return { ok: false, detail: 'No staff profile for this person in this funeral home.' };
  }
  if (funeralDirectorRoleKeys.includes(approver.roleKey)) return { ok: true, detail: '', basis: 'funeral_director_role' };
  const grant = profile.funeralDirectorAuthorization;
  if (grant && grant.authorizedBy && grant.authorizedBy !== approver.identityId && !Number.isNaN(Date.parse(grant.authorizedAt))) {
    return { ok: true, detail: '', basis: 'funeral_director_authorization' };
  }
  if (grant && grant.authorizedBy === approver.identityId) return { ok: false, detail: 'Funeral Director authorization cannot be self-granted.' };
  return { ok: false, detail: 'Not authorized as a Funeral Director (the role alone, e.g. Administrator, is not enough).' };
}

export function evaluateReleaseForCremation(params: {
  case_: Case;
  definition: ServicePreparationDefinition;
  readiness: ServiceReadiness;
  /** null when evaluated for display without a signed-in approver. */
  approver: ReleaseApprover | null;
  /** The organization's Funeral Director role key(s) (profile). */
  approverRoleKeys: readonly string[];
  /** License re-verification interval in days; null = not decided yet. */
  licenseReverifyDays: number | null;
  timeZone: string;
  now: string;
}): ReleaseEvaluation {
  const { case_, readiness, definition, approver } = params;
  const prepDone = (id: string) => readiness.items.find((i) => i.id === id)?.done === true;
  const death = deathInstant(case_.dateOfDeath, case_.timeOfDeath, params.timeZone);
  const hours = death === null ? null : (Date.parse(params.now) - death) / HOUR;
  const license = approver?.staffProfile
    ? checkFuneralDirectorLicense(approver.staffProfile, { organizationId: case_.organizationId, today: params.now.slice(0, 10), now: params.now, reverifyWithinDays: params.licenseReverifyDays })
    : { verified: false, problems: ['No staff profile for this person.'], notes: [] };
  const authorized = approver ? approverAuthorization(approver, case_.organizationId, params.approverRoleKeys) : { ok: false, detail: 'No one is signed in.' };
  const serviceSpecific = definition.releasePrerequisiteItems ?? [];
  const meApproval = checkMedicalExaminerApproval(case_.crematory?.medicalExaminerApproval, { dateOfDeath: case_.dateOfDeath, today: params.now.slice(0, 10) });

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
      met: meApproval.valid,
      ...(meApproval.valid ? {} : { detail: meApproval.problems.join(' ') }),
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
      label: 'Approved by an authorized Funeral Director',
      met: authorized.ok,
      ...(authorized.ok ? {} : { detail: authorized.detail }),
    },
    {
      key: 'approver_licensed',
      label: 'Approver is a verified, licensed funeral director',
      met: license.verified,
      ...(license.verified ? (license.notes.length ? { detail: license.notes.join(' ') } : {}) : { detail: license.problems.join(' ') }),
    },
  ];

  const record = case_.servicePreparation && case_.servicePreparation.definitionKey === definition.key ? case_.servicePreparation : null;
  const status = releaseStatusOf(record);
  const released = isReleasedStatus(status);
  const hold = currentHold(record);
  const allPrerequisitesMet = readiness.holdsCremation === true && prerequisites.every((p) => p.met);
  const casePrerequisitesMet = readiness.holdsCremation === true && prerequisites.every((p) => p.met || p.key === 'approver_authorized' || p.key === 'approver_licensed');
  return {
    applies: readiness.holdsCremation,
    released,
    status,
    hold: hold ? { reason: hold.reason ?? null, at: hold.at, byName: hold.actorName, paperworkAlreadyTransmitted: hold.paperworkAlreadyTransmitted === true } : null,
    casePrerequisitesMet,
    prerequisites,
    allPrerequisitesMet,
    canRelease: RELEASE_FOR_CREMATION_AVAILABLE && allPrerequisitesMet && !released,
    unavailableReason: RELEASE_FOR_CREMATION_AVAILABLE ? null : RELEASE_FOR_CREMATION_UNAVAILABLE_REASON,
  };
}

/** What a release records: the approving director (and why they count as
    one), their license, the case, the time and every satisfied
    prerequisite. Refuses unless every prerequisite is met. */
export type CremationReleaseRecord = {
  caseId: string;
  organizationId: string;
  serviceAppointmentId: string | null;
  approvedAt: string;
  approvedBy: {
    identityId: string;
    staffProfileId: string;
    name: string;
    roleKey: string;
    basis: ReleaseApprovalSnapshot['basis'];
    licenseNumber: string;
    licenseState: string;
    licenseExpiresOn: string;
    licenseVerifiedAt: string | null;
    licenseVerifiedBy: string | null;
  };
  prerequisites: { key: ReleasePrerequisiteKey; label: string }[];
};

export class ReleaseRefusedError extends Error {}

export function buildCremationReleaseRecord(params: {
  case_: Case;
  evaluation: ReleaseEvaluation;
  approver: ReleaseApprover;
  approverRoleKeys?: readonly string[];
  serviceAppointmentId: string | null;
  now: string;
}): CremationReleaseRecord {
  const { evaluation, approver } = params;
  const license = approver.staffProfile?.funeralDirectorLicense;
  if (!evaluation.allPrerequisitesMet || !approver.staffProfile || !license) {
    throw new ReleaseRefusedError('Release refused: not every prerequisite is met.');
  }
  const authorization = approverAuthorization(approver, params.case_.organizationId, params.approverRoleKeys ?? [approver.roleKey]);
  if (!authorization.ok || !authorization.basis) throw new ReleaseRefusedError('Release refused: not every prerequisite is met.');
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
      basis: authorization.basis,
      licenseNumber: license.licenseNumber,
      licenseState: license.state,
      licenseExpiresOn: license.expiresOn,
      licenseVerifiedAt: license.verification?.verifiedAt ?? null,
      licenseVerifiedBy: license.verification?.verifiedBy ?? null,
    },
    prerequisites: evaluation.prerequisites.map((p) => ({ key: p.key, label: p.label })),
  };
}

/** The licensed sign-off as stored on a `released` / `reauthorized` event. */
export function approvalSnapshotOf(release: CremationReleaseRecord): ReleaseApprovalSnapshot {
  return {
    staffProfileId: release.approvedBy.staffProfileId,
    basis: release.approvedBy.basis,
    licenseNumber: release.approvedBy.licenseNumber,
    licenseState: release.approvedBy.licenseState,
    licenseExpiresOn: release.approvedBy.licenseExpiresOn,
    licenseVerifiedAt: release.approvedBy.licenseVerifiedAt,
    licenseVerifiedBy: release.approvedBy.licenseVerifiedBy,
    serviceAppointmentId: release.serviceAppointmentId,
    prerequisites: release.prerequisites,
  };
}

/**
 * The preparation record with a licensed sign-off added (Gus Phase 5K;
 * holds 2026-11): `released` for the first release, `reauthorized` to lift
 * a hold. The event and its history entry are in ONE record, so they are
 * saved together or not at all. The original release is never overwritten.
 */
export function applyCremationRelease(params: {
  definition: ServicePreparationDefinition;
  record: ServicePreparationRecord | null;
  release: CremationReleaseRecord;
  eventId: string;
  type?: 'released' | 'reauthorized';
}): ServicePreparationRecord {
  const event: ReleaseEvent = {
    eventId: params.eventId,
    type: params.type ?? 'released',
    at: params.release.approvedAt,
    actorId: params.release.approvedBy.identityId,
    actorName: params.release.approvedBy.name,
    roleKey: params.release.approvedBy.roleKey,
    approval: approvalSnapshotOf(params.release),
  };
  return appendReleaseEvent({ definition: params.definition, record: params.record, event });
}

/**
 * The Send to Crematory release gate (Gus Phase 5K). For a case whose
 * service holds cremation (Viewing, Final Goodbye — and a Mass while
 * "body present?" is unanswered), the crematory package may not be SENT
 * until the release is recorded. Null when the gate does not apply: the
 * organization does not enforce it, or the case has no such service.
 * Enforcement is the organization profile's
 * `sendToCrematory.requireReleaseAfterService` — OFF everywhere until
 * approved.
 */
export type CrematoryReleaseGate = { serviceName: string; released: boolean; undecided: boolean; onHold?: boolean; holdReason?: string | null };

export function crematoryReleaseGate(case_: Pick<Case, 'workflowSnapshot' | 'servicePreparation'>, enforced: boolean): CrematoryReleaseGate | null {
  if (!enforced) return null;
  const definition = servicePreparationFor(case_.workflowSnapshot?.serviceTypeCode);
  if (!definition) return null;
  const record = case_.servicePreparation && case_.servicePreparation.definitionKey === definition.key ? case_.servicePreparation : null;
  const holds = serviceHoldsCremation(definition, record);
  if (holds === false) return null;
  const status = releaseStatusOf(record);
  const hold = currentHold(record);
  return { serviceName: definition.serviceName, released: isReleasedStatus(status), undecided: holds === 'undecided', onHold: hold !== null, holdReason: hold?.reason ?? null };
}

/**
 * Refusal for anything that would record paperwork as SENT to the crematory
 * — the "sent to crematory" checklist steps, or a send recorded as made
 * outside SOLIS — while the release gate applies and the case is not
 * released (or is on hold). Null when allowed. The gate's own setting
 * decides whether this applies at all (off everywhere today).
 */
export function releaseGateRefusal(case_: Pick<Case, 'workflowSnapshot' | 'servicePreparation'>, enforced: boolean): string | null {
  const gate = crematoryReleaseGate(case_, enforced);
  if (!gate || gate.released) return null;
  return gate.onHold
    ? `The release is on hold${gate.holdReason ? ` (${gate.holdReason})` : ''}. Nothing may be recorded as sent to the crematory until it is reauthorized.`
    : `The remains must be released for cremation after the ${gate.serviceName.toLowerCase()} before anything is recorded as sent to the crematory.`;
}
