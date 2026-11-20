/**
 * Service preparation (Gus Phase 5B, 2026-11).
 *
 * Getting ready for a service the family attends BEFORE cremation — a
 * Viewing, a Final Goodbye, a Mass with the body present: the casket,
 * flowers, prayer cards, clergy, church, and the hold that keeps the
 * crematory from cremating before the service.
 *
 * Preparation is deliberately NOT part of the linear case workflow:
 * - staff can work it from the moment arrangements are made, while EDRS
 *   or any earlier stage is still open — nothing here reads `rawStage`;
 * - it never advances, completes or unchecks a workflow stage or item;
 * - it never records a legal step. Cremation authorization, the burial-
 *   transit permit, medical examiner approval, identification and sending
 *   to the crematory stay exactly where they are (the cremation foundation
 *   and Send to Crematory). No preparation id may use the `cremation.`
 *   namespace those steps live in (servicePreparation.test.ts).
 *
 * Every preparation id is stable, so a stored record keyed by id never
 * duplicates an item when the service is rescheduled or the definition is
 * re-read.
 */

/** What staff record about one preparation item. */
export type PreparationStatus =
  | 'pending'
  /** Asked for (ordered, requested, called) — waiting for the vendor,
      church, clergy or crematory to confirm. */
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'completed'
  /** The family did not ask for it. Only an optional item can be. */
  | 'not_requested'
  /** Something went wrong (vendor can't deliver, church unavailable). */
  | 'attention_needed';

export const PREPARATION_STATUS_LABEL: Record<PreparationStatus, string> = {
  pending: 'Pending',
  awaiting_confirmation: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  completed: 'Completed',
  not_requested: 'Not requested',
  attention_needed: 'Needs attention',
};

/** The operational targets a preparation item can carry (deadlines.ts). */
export type PreparationTargetKey =
  | 'crematory_notification'
  | 'casket_order'
  | 'church_coordination'
  | 'clergy_confirmation'
  | 'casket_spray'
  | 'prayer_card_printing';

/** A choice made with the family that switches items on or off. */
export type PreparationCondition = { choice: string; equals: readonly string[] };

export type PreparationItemDefinition = {
  /** Stable, `prep.` namespace. */
  id: string;
  label: string;
  /** Required items must be confirmed or completed. Optional items may
      instead be marked Not requested; they never block readiness then. */
  requirement: 'required' | 'optional';
  /** 'confirmation' items are confirmed by someone outside (vendor,
      church, clergy, crematory); 'task' items are done by staff. */
  kind: 'task' | 'confirmation';
  /** The item only applies when this choice has one of these values. */
  appliesWhen?: PreparationCondition;
  /** The confirmation is for one service date and time: after a
      reschedule it must be confirmed again. */
  dateDependent: boolean;
  target?: PreparationTargetKey;
  /** Has to be in place before the family arrives. */
  beforeFamilyArrives: boolean;
  /** Where the supporting document goes, if one is usual (the existing
      Documents tab; nothing is uploaded from here). */
  supportingDocument?: string;
};

export type PreparationChoiceDefinition = {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
};

/** Details recorded with an item (names, numbers, the card's language) —
    information, never a completion. */
export type PreparationDetailDefinition = {
  key: string;
  label: string;
  kind: 'text' | 'phone' | 'select' | 'number';
  options?: readonly { value: string; label: string }[];
  /** For 'number': the most allowed (e.g. 6 attendees). Refused above it. */
  max?: number;
};

export type PreparationGroupKey =
  | 'service_schedule'
  | 'crematory_hold'
  | 'embalming'
  | 'clothing'
  | 'casket'
  | 'casket_spray'
  | 'prayer_cards'
  | 'register_book'
  | 'crucifix'
  | 'clergy'
  | 'church'
  | 'transportation_staffing'
  | 'day_of_service'
  | 'final_goodbye_setup'
  | 'face_viewing';

export type PreparationGroupDefinition = {
  key: PreparationGroupKey;
  label: string;
  /** The group applies only when this choice has one of these values. */
  appliesWhen?: PreparationCondition;
  /** An optional group: the choice (Requested / Not requested) that the
      family answers. Undecided shows as a decision to make. */
  requestedBy?: string;
  items: readonly PreparationItemDefinition[];
  details?: readonly PreparationDetailDefinition[];
};

/** One service's preparation, built from shared groups. */
export type ServicePreparationDefinition = {
  key: string;
  version: number;
  serviceTypeCode: string;
  serviceName: string;
  /** The appointment type the service itself is scheduled as. */
  serviceAppointmentType: string;
  /** Draft until the funeral home's licensed funeral director approves
      the steps. A draft is shown to staff as provisional. */
  status: 'draft' | 'approved';
  /** Whether cremation must wait for this service. */
  holdsCremation: 'always' | PreparationCondition;
  choices: readonly PreparationChoiceDefinition[];
  groups: readonly PreparationGroupDefinition[];
  /** Open questions shown with a draft. */
  openQuestions: readonly string[];
  /** Limits the service itself must respect (Final Goodbye: 60 minutes,
      provisional). A scheduled service past them is flagged for review. */
  serviceLimits?: { maxDurationMinutes?: number; durationProvisional?: boolean };
  /** Steps that must be done before release for cremation, beyond the
      legal ones every cremation has (Viewing: embalming authorization). */
  releasePrerequisiteItems?: readonly { itemId: string; label: string }[];
};

/** The latest decision about one item. Full history belongs in Activity. */
export type PreparationItemRecord = {
  status: PreparationStatus;
  /** For a date-dependent item: the service start this confirmation was
      for (ISO-8601). */
  forServiceStartAt?: string | null;
  note?: string | null;
  /** A supporting document already on the case (caseDocuments id). */
  documentId?: string | null;
  at: string;
  by: string | null;
  byName?: string | null;
};

export type ReleaseForCremationRecord = {
  releasedAt: string;
  /** The approving funeral director's identity id. */
  releasedBy: string;
  releasedByName: string | null;
  roleKey: string;
  /** Server-generated; also the history entry's and the Activity event's id
      (Phase 5K). Absent only on records written before it existed. */
  eventId?: string;
  /** What the release rested on, as it was at that moment (Phase 5K). */
  approval?: ReleaseApprovalSnapshot;
};

/**
 * Release-hold workflow (Gus, 2026-11). Every step is one append-only event;
 * the current status is worked out from them (releaseHolds.ts). The first
 * `released` event's record is also kept in `release` and never changed.
 *
 *   release_requested         — an Administrator, Manager or Funeral Director
 *                               asked for release; a licensed director's
 *                               sign-off is still needed
 *   released                  — released (licensed sign-off recorded)
 *   hold_placed               — on hold (reason required); sending blocked
 *   reauthorization_requested — asked to lift the hold; sign-off needed
 *   reauthorized              — hold lifted after the latest requirements
 *                               were rechecked and a licensed director signed
 */
export type ReleaseEventType = 'release_requested' | 'released' | 'hold_placed' | 'reauthorization_requested' | 'reauthorized';

export type ReleaseEvent = {
  eventId: string;
  type: ReleaseEventType;
  at: string;
  actorId: string;
  actorName: string | null;
  roleKey: string;
  /** Required for a hold. */
  reason?: string | null;
  /** The licensed sign-off (released / reauthorized). */
  approval?: ReleaseApprovalSnapshot | null;
  /** A hold placed after paperwork already reached (or may have reached)
      the crematory: staff must contact the crematory. A hold in SOLIS
      never recalls anything. */
  paperworkAlreadyTransmitted?: boolean;
};

/** The approving director and every satisfied prerequisite, frozen at the
    moment of release (domain/servicePreparation/releaseForCremation.ts). */
export type ReleaseApprovalSnapshot = {
  staffProfileId: string;
  /** Why this person counts as a Funeral Director. */
  basis: 'funeral_director_role' | 'funeral_director_authorization';
  licenseNumber: string;
  licenseState: string;
  licenseExpiresOn: string;
  licenseVerifiedAt: string | null;
  licenseVerifiedBy: string | null;
  serviceAppointmentId: string | null;
  prerequisites: { key: string; label: string }[];
};

/** Who last set a choice or detail, and when. */
export type PreparationValueRecord = { value: string; at: string; by: string | null; byName?: string | null };

/**
 * The `servicePreparation` case field (docs/SERVICE_PREPARATION.md). The
 * LATEST state only — every change, with its previous value, is also an
 * Activity event, which is the history. Written only by
 * services/servicePreparationService.ts.
 */
export type ServicePreparationRecord = {
  definitionKey: string;
  definitionVersion: number;
  serviceAppointmentId: string | null;
  choices: Record<string, PreparationValueRecord>;
  details: Record<string, PreparationValueRecord>;
  items: Record<string, PreparationItemRecord>;
  release?: ReleaseForCremationRecord | null;
  /** Release-hold workflow events, oldest first (append-only). */
  releaseEvents?: ReleaseEvent[];
  /** Append-only audit history (Phase 5E): one entry per saved change,
      written in the SAME revision-checked write as the change itself, so a
      change can never exist without its entry. Never edited or trimmed.
      Absent on records saved before it existed. */
  history?: PreparationAuditEntry[];
};

/** One saved change, as it was made. `eventId` is generated by the server
    and is also the correlationId of the matching Activity event. */
export type PreparationAuditEntry = {
  eventId: string;
  /** 'release' (Phase 5K): the release for cremation itself. */
  target: { kind: 'item' | 'choice' | 'detail' | 'release'; key: string };
  description: string;
  previous: PreparationItemRecord | PreparationValueRecord | ReleaseForCremationRecord | ReleaseEvent | null;
  next: PreparationItemRecord | PreparationValueRecord | ReleaseForCremationRecord | ReleaseEvent;
  actorId: string;
  actorName: string | null;
  at: string;
};

/** The service appointment, as preparation needs it. */
export type ServiceEvent = {
  appointmentId: string;
  startAt: string;
  endAt: string;
  status: 'draft' | 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  /** When this appointment was booked — decides "short notice". */
  bookedAt: string;
};
