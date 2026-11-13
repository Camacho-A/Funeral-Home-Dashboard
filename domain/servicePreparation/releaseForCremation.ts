import type { ServiceReadiness } from './readiness';
import type { ServicePreparationRecord } from './types';

/**
 * Release for cremation (Gus Phase 5B, 2026-11) — the service hold.
 *
 * When cremation must wait for a service, the remains are released only
 * after: the crematory was told about the service, the crematory confirmed
 * the hold for the current date, the service took place, and an
 * authorized funeral director approves the release.
 *
 * The hold is IN ADDITION to the legal requirements, never instead of
 * them: cremation authorization, the burial-transit permit, medical
 * examiner approval, identification and the 48-hour wait are still checked
 * where they are today (the cremation workflow and Send to Crematory),
 * which this module neither reads nor changes.
 *
 * DISABLED. SOLIS cannot yet tell who is a licensed funeral director: a
 * role is assigned by an administrator, and no staff record holds a
 * license. And the release has nowhere to be stored until the
 * `servicePreparation` case field is approved. Rather than show an
 * approval button that proves nothing, the release stays disabled with the
 * reason shown (docs/SERVICE_PREPARATION.md, "Release permission").
 */
export const RELEASE_FOR_CREMATION_AVAILABLE = false;
export const RELEASE_FOR_CREMATION_UNAVAILABLE_REASON =
  'Release for cremation is not available yet: SOLIS cannot yet confirm which staff are licensed funeral directors, and the release has no approved place to be saved.';

/** Still required before cremation, and still checked by the existing
    workflow — listed so no one mistakes the hold for them. */
export const LEGAL_REQUIREMENTS_STILL_CHECKED = [
  'Cremation authorization from the legally authorized person',
  'Burial-transit permit',
  'Medical examiner approval',
  'Identification of the remains',
  'At least 48 hours since death',
] as const;

export type ReleaseRequirement = { key: 'crematory_notified' | 'hold_confirmed' | 'service_completed' | 'authorized_approver'; label: string; met: boolean };

export type ReleaseEvaluation = {
  /** The hold applies to this case (or is undecided until a choice is made). */
  applies: boolean | 'undecided';
  released: boolean;
  requirements: ReleaseRequirement[];
  canRelease: boolean;
  unavailableReason: string | null;
};

export function evaluateReleaseForCremation(params: {
  readiness: ServiceReadiness;
  record: ServicePreparationRecord | null;
  /** From the server's permission check — never from the client. */
  actorMayRelease: boolean;
}): ReleaseEvaluation {
  const { readiness } = params;
  const doneById = (id: string) => readiness.items.find((i) => i.id === id)?.done === true;
  const requirements: ReleaseRequirement[] = [
    { key: 'crematory_notified', label: 'Crematory told about the service', met: doneById('prep.crematory.notified') },
    { key: 'hold_confirmed', label: 'Crematory confirmed the hold for the current date', met: doneById('prep.crematory.hold_confirmed') },
    { key: 'service_completed', label: `${readiness.serviceName} completed`, met: readiness.service?.status === 'completed' },
    { key: 'authorized_approver', label: 'Approved by an authorized funeral director', met: params.actorMayRelease },
  ];
  const released = Boolean(params.record?.release);
  const canRelease = RELEASE_FOR_CREMATION_AVAILABLE && readiness.holdsCremation === true && !released && requirements.every((r) => r.met);
  return {
    applies: readiness.holdsCremation,
    released,
    requirements,
    canRelease,
    unavailableReason: RELEASE_FOR_CREMATION_AVAILABLE ? null : RELEASE_FOR_CREMATION_UNAVAILABLE_REASON,
  };
}
