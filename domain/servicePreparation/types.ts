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
export type PreparationDetailDefinition = { key: string; label: string; kind: 'text' | 'phone' | 'select'; options?: readonly { value: string; label: string }[] };

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
  | 'day_of_service';

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
};

/** The latest decision about one item. Full history belongs in Activity. */
export type PreparationItemRecord = {
  status: PreparationStatus;
  /** For a date-dependent item: the service start this confirmation was
      for (ISO-8601). */
  forServiceStartAt?: string | null;
  note?: string | null;
  at: string;
  by: string | null;
  byName?: string | null;
};

export type ReleaseForCremationRecord = {
  releasedAt: string;
  releasedBy: string;
  releasedByName: string | null;
  roleKey: string;
};

/**
 * PROPOSED storage — the `servicePreparation` case field
 * (docs/SERVICE_PREPARATION.md). Not in Wix yet: nothing writes this
 * until the field is approved.
 */
export type ServicePreparationRecord = {
  definitionKey: string;
  definitionVersion: number;
  serviceAppointmentId: string | null;
  choices: Record<string, string>;
  details: Record<string, string>;
  items: Record<string, PreparationItemRecord>;
  release?: ReleaseForCremationRecord | null;
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
