import type { Case } from '../../types/case';
import { SLA_EVENT_KEYS } from '../../types/sla';
import type {
  SlaDelayReason,
  SlaDelayRecord,
  SlaEventKey,
  SlaMilestoneKey,
  SlaResponsibleParty,
  SlaStatus,
} from '../../types/sla';
import { findStageByRawStage } from '../workflow/resolveStages';
import { checklistItemKey } from '../workflow/checklistItemKey';
import {
  addBusinessDays,
  businessDaysBetween,
  effectiveStartDate,
  isBusinessDay,
  addCalendarDays,
  localDateTime,
  toLocalDate,
  weekdayOf,
  type BusinessCalendar,
  type LocalDate,
} from './businessCalendar';
import { businessCalendarFor, type SlaSettings } from './slaSettings';

/**
 * SLA milestones (2026-10). The one place SLA status is calculated — the
 * case header, the SLA details panel, the dashboard and the SLA alert sweep
 * all call `evaluateCaseSla`, so they can never disagree.
 *
 * Six milestones, each independent of the workflow stage:
 *
 *   EDRS entry             case received        → EDRS submitted       2 business days  staff
 *   Doctor attestation     EDRS submitted       → attestation received 4                doctor
 *   Hard Save              attestation received → Hard Save            same day         staff
 *   State approval         Hard Save            → approval             2                state
 *   Crematory turnaround   crematory receipt    → cremains ready       5 (fixed days)   crematory
 *   Family pickup          cremains ready       → release              5 (advisory)     family
 *
 * A milestone starts and stops on RECORDED events only:
 *   - an SLA event recorded on the case (`slaEvents`, staff or SOLIS);
 *   - a checklist completion with its own record (the item's stable
 *     displayStage:index, shape-guarded by its stored label);
 *   - case data that is itself the fact (Date Received, the release record).
 * A later event implies the earlier ones happened (a Hard Save implies the
 * attestation arrived), and a stage the case has moved past implies its
 * own events — but the TIME of an implied event is unknown, and a milestone
 * whose start time is unknown is "Start Date Needed", never given an
 * invented deadline.
 *
 * Recording a delay never moves a deadline or clears an overdue state:
 * `overdue` and the delay are reported side by side.
 */

export type EventTime = { date: LocalDate; minutes: number | null };

/** Where an event's evidence came from: recorded on the case's SLA events,
    a checklist completion record, case data (Date Received, the release
    record), or implied by a later event or a stage the case has passed. */
export type SlaEventSource = 'recorded' | 'checklist' | 'case' | 'implied';

type EventInfo = { occurred: boolean; time: EventTime | null; source: SlaEventSource | null };

const NOT_OCCURRED: EventInfo = { occurred: false, time: null, source: null };
const OCCURRED_TIME_UNKNOWN: EventInfo = { occurred: true, time: null, source: 'implied' };

/** Checklist items that ARE an SLA event, by stable key, guarded by the
    label stored in the case's own snapshot (Manors' template). */
/** Events SOLIS derives from the case itself rather than recording:
    - `cremains_received`: the cremains are back with Manors — Date Received,
      or the "Ashes picked up (Tue/Fri)" checklist item (Manors collecting
      them from the crematory; the expected-pickup appointment completes
      with it), or implied by the release;
    - `released`: the authorized release to the family (or delivery);
    - `me_verified`: a Medical Examiner case's staff verification. */
export type SlaDerivedEventKey = 'cremains_received' | 'released' | 'me_verified';

const CHECKLIST_EVENTS: Partial<Record<SlaEventKey | SlaDerivedEventKey, ReadonlyArray<{ displayStage: number; index: number; expectedLabel: string }>>> = {
  edrs_submitted: [{ displayStage: 2, index: 0, expectedLabel: 'EDRS submitted & sent to doctor' }],
  hard_saved: [{ displayStage: 2, index: 2, expectedLabel: 'Hardsave for state approval if not an online doctor' }],
  permit_sent: [{ displayStage: 3, index: 0, expectedLabel: 'Permit sent to crematory' }],
  sent_to_crematory: [
    { displayStage: 3, index: 0, expectedLabel: 'Permit sent to crematory' },
    { displayStage: 3, index: 1, expectedLabel: 'Authorization of release sent to crematory' },
  ],
  cremains_received: [{ displayStage: 5, index: 0, expectedLabel: 'Ashes picked up (Tue/Fri)' }],
};

/** Medical Examiner cases: staff verify the ME's work instead of EDRS,
    doctor and Hard Save; the last verification item starts approval. */
const ME_VERIFIED_ITEM = { displayStage: 2, index: 5 };

/** The checklist item(s) backing an event, when the case's snapshot has them. */
export function checklistItemsForEvent(case_: Pick<Case, 'workflowSnapshot'>, event: SlaEventKey | SlaDerivedEventKey): Array<{ displayStage: number; index: number }> {
  const mapping = CHECKLIST_EVENTS[event];
  if (!mapping || !case_.workflowSnapshot) return [];
  const found = mapping.filter((entry) => {
    const stage = case_.workflowSnapshot!.stages.find((candidate) => candidate.displayStage === entry.displayStage);
    return stage?.checklist.items.some((item) => item.index === entry.index && item.label === entry.expectedLabel) === true;
  });
  return found.length === mapping.length ? found.map(({ displayStage, index }) => ({ displayStage, index })) : [];
}

export const SLA_EVENT_LABEL: Record<SlaEventKey, string> = {
  case_received: 'Case received',
  vital_statistics_received: 'Vital Statistics received',
  edrs_submitted: 'EDRS submitted to doctor',
  attestation_received: 'Doctor attestation received',
  hard_saved: 'Hard Saved',
  submitted_for_approval: 'Submitted for state approval',
  approval_received: 'State approval received',
  permit_sent: 'Permit sent to crematory',
  sent_to_crematory: 'Sent to crematory',
  crematory_received: 'Received by crematory',
  cremains_ready: 'Cremains ready',
};

/** The events staff record to start or complete each milestone (the
    family-pickup release is recorded through Record pickup, not here). */
export const SLA_MILESTONE_EVENTS: Record<SlaMilestoneKey, { start: SlaEventKey | null; stop: SlaEventKey | null }> = {
  edrs_entry: { start: 'case_received', stop: 'edrs_submitted' },
  doctor_attestation: { start: 'edrs_submitted', stop: 'attestation_received' },
  hard_save: { start: 'attestation_received', stop: 'hard_saved' },
  approval: { start: 'submitted_for_approval', stop: 'approval_received' },
  crematory_turnaround: { start: 'crematory_received', stop: 'cremains_ready' },
  // Both ends of family pickup come from the case: Date Received (Schedule
  // tab) and the release (Record pickup).
  family_pickup: { start: null, stop: null },
};

export const SLA_EVENT_SOURCE_LABEL: Record<SlaEventSource, string> = {
  recorded: 'recorded',
  checklist: 'from the checklist',
  case: 'from the case',
  implied: 'implied — time not recorded',
};

export const SLA_MILESTONE_LABEL: Record<SlaMilestoneKey, string> = {
  edrs_entry: 'EDRS entry',
  doctor_attestation: 'Doctor attestation',
  hard_save: 'Hard Save',
  approval: 'State approval',
  crematory_turnaround: 'Crematory turnaround',
  family_pickup: 'Family pickup',
};

export const SLA_RESPONSIBLE_LABEL: Record<SlaResponsibleParty, string> = {
  staff: 'Staff',
  family: 'Family',
  doctor: 'Doctor',
  medical_examiner: 'Medical Examiner',
  state: 'State (Vital Statistics)',
  crematory: 'Crematory',
  other: 'Other',
};

export const SLA_STATUS_LABEL: Record<SlaStatus, string> = {
  on_track: 'On Track',
  due_soon: 'Due Soon',
  due_today: 'Due Today',
  overdue: 'Overdue',
  waiting_on_others: 'Waiting on Others',
  exception_acknowledged: 'Exception Acknowledged',
  completed: 'Completed',
  start_date_needed: 'Start Date Needed',
};

export const SLA_DELAY_REASON_LABEL: Record<SlaDelayReason, string> = {
  waiting_on_family: 'Waiting on Family',
  waiting_on_doctor: 'Waiting on Doctor',
  medical_examiner: 'Medical Examiner',
  crematory_delay: 'Crematory Delay',
  equipment_issue: 'Equipment Issue',
  family_vacation: 'Family Vacation',
  other: 'Other',
};

/** Who a delay reason points at, and whether it is someone else's wait or
    an exception staff have acknowledged. */
export const SLA_DELAY_REASON_PARTY: Record<SlaDelayReason, { party: SlaResponsibleParty; status: 'waiting_on_others' | 'exception_acknowledged' }> = {
  waiting_on_family: { party: 'family', status: 'waiting_on_others' },
  waiting_on_doctor: { party: 'doctor', status: 'waiting_on_others' },
  medical_examiner: { party: 'medical_examiner', status: 'waiting_on_others' },
  crematory_delay: { party: 'crematory', status: 'waiting_on_others' },
  equipment_issue: { party: 'crematory', status: 'waiting_on_others' },
  family_vacation: { party: 'family', status: 'exception_acknowledged' },
  other: { party: 'other', status: 'exception_acknowledged' },
};

type MilestoneDefinition = {
  key: SlaMilestoneKey;
  responsible: SlaResponsibleParty;
  start: SlaEventKey | SlaDerivedEventKey;
  stop: SlaEventKey | SlaDerivedEventKey;
  target: (settings: SlaSettings) => number;
  advisory?: boolean;
  /** Not tracked for a Medical Examiner case (the ME does this work). */
  standardCaseOnly?: boolean;
};

const MILESTONES: readonly MilestoneDefinition[] = [
  { key: 'edrs_entry', responsible: 'staff', start: 'case_received', stop: 'edrs_submitted', target: (s) => s.targets.edrsEntry, standardCaseOnly: true },
  { key: 'doctor_attestation', responsible: 'doctor', start: 'edrs_submitted', stop: 'attestation_received', target: (s) => s.targets.doctorAttestation, standardCaseOnly: true },
  { key: 'hard_save', responsible: 'staff', start: 'attestation_received', stop: 'hard_saved', target: (s) => s.targets.hardSave, standardCaseOnly: true },
  { key: 'approval', responsible: 'state', start: 'submitted_for_approval', stop: 'approval_received', target: (s) => s.targets.approval },
  { key: 'crematory_turnaround', responsible: 'crematory', start: 'crematory_received', stop: 'cremains_ready', target: (s) => s.targets.crematoryTurnaround },
  { key: 'family_pickup', responsible: 'family', start: 'cremains_received', stop: 'released', target: (s) => s.targets.familyPickup, advisory: true },
];

/** `not_recorded`: the case has moved on (the crematory has the decedent)
    but the milestone's completion was never recorded. Shown as such; never
    counted as met, and never the current milestone. */
export type SlaMilestoneState = 'not_applicable' | 'not_started' | 'start_date_needed' | 'active' | 'completed' | 'not_recorded';

export type SlaMilestoneEvaluation = {
  key: SlaMilestoneKey;
  label: string;
  responsibleParty: SlaResponsibleParty;
  /** True for the family pickup reminder: shown, never treated as staff failure. */
  advisory: boolean;
  /** Someone other than staff is responsible for meeting it. */
  external: boolean;
  state: SlaMilestoneState;
  /** Null when the milestone is not applicable or not started. */
  status: SlaStatus | null;
  /** The deadline has passed — kept even when a delay is recorded. */
  overdue: boolean;
  startedAt: EventTime | null;
  completedAt: EventTime | null;
  deadline: LocalDate | null;
  /** Business days until the deadline; negative once overdue; null without a deadline. */
  businessDaysRemaining: number | null;
  /** The active (unresolved) delay on this milestone, if any. */
  delay: SlaDelayRecord | null;
  /** Context worth showing (waiting on family paperwork, information available for N days, …). */
  note: string | null;
};

export type CaseSlaEvaluation = {
  enabled: boolean;
  milestones: SlaMilestoneEvaluation[];
  /** The first milestone needing work or a start date; null when none. */
  current: SlaMilestoneEvaluation | null;
  /** Business days since the case entered its stage; null when unknown. */
  businessDaysInStage: number | null;
  /** Every SLA event with its time and where the evidence came from. */
  events: SlaEventTimelineEntry[];
};

export type SlaEventTimelineEntry = { key: SlaEventKey | SlaDerivedEventKey; label: string; occurred: boolean; time: EventTime | null; source: SlaEventSource | null };

const EMPTY: CaseSlaEvaluation = { enabled: false, milestones: [], current: null, businessDaysInStage: null, events: [] };

function eventTimeFromIso(iso: string | null | undefined, calendar: BusinessCalendar): EventTime | null {
  if (!iso) return null;
  const local = localDateTime(iso, calendar.timezone);
  return local ? { date: local.date, minutes: local.minutes } : null;
}

function dateOnly(value: string | null | undefined): EventTime | null {
  const date = toLocalDate(value);
  return date ? { date, minutes: null } : null;
}

type SlaCase = Pick<
  Case,
  | 'organizationId'
  | 'rawStage'
  | 'isDeleted'
  | 'isMedicalExaminerCase'
  | 'workflowSnapshot'
  | 'checklistState'
  | 'checklistCompletions'
  | 'slaEvents'
  | 'slaDelays'
  | 'stageEnteredAt'
  | 'cremainsReceivedAt'
  | 'pickupStatus'
  | 'pickupReleasedAt'
  | 'returnMethod'
  | 'shippingDeliveryStatus'
  | 'shippingDeliveredAt'
>;

/** Resolves every event once, applying the implications described above. */
function resolveEvents(case_: SlaCase, calendar: BusinessCalendar): Record<SlaEventKey | SlaDerivedEventKey, EventInfo> {
  const currentDisplayStage = case_.workflowSnapshot
    ? (findStageByRawStage(case_.workflowSnapshot, case_.rawStage)?.displayStage ?? case_.rawStage)
    : case_.rawStage;

  const recorded = (key: SlaEventKey): EventInfo => {
    const record = case_.slaEvents?.[key];
    const time = eventTimeFromIso(record?.at, calendar);
    return record && time ? { occurred: true, time, source: 'recorded' } : NOT_OCCURRED;
  };

  /** A checklist-backed event: done when every backing item is done (or
      the case has moved past their stage); its time is the latest
      completion record, when every item has one that is not a historical
      correction. */
  const fromChecklist = (key: SlaEventKey | SlaDerivedEventKey): EventInfo => {
    const items = checklistItemsForEvent(case_, key);
    if (items.length === 0) return NOT_OCCURRED;
    const allDone = items.every(
      (item) => item.displayStage < currentDisplayStage || case_.checklistState[checklistItemKey(item.displayStage, item.index)] === true,
    );
    if (!allDone) return NOT_OCCURRED;
    const times = items.map((item) => {
      const record = case_.checklistCompletions?.[checklistItemKey(item.displayStage, item.index)];
      // A historical correction's time is when the correction was made,
      // never when the work happened (2026-10): unknown, not that date.
      return record?.done && record.historical !== true ? eventTimeFromIso(record.at, calendar) : null;
    });
    if (times.some((time) => time === null)) return { occurred: true, time: null, source: 'checklist' };
    const latest = (times as EventTime[]).reduce((a, b) => (a.date > b.date || (a.date === b.date && (a.minutes ?? 0) >= (b.minutes ?? 0)) ? a : b));
    return { occurred: true, time: latest, source: 'checklist' };
  };

  const either = (...infos: EventInfo[]): EventInfo => infos.find((info) => info.occurred && info.time) ?? infos.find((info) => info.occurred) ?? NOT_OCCURRED;

  const delivered = case_.returnMethod === 'shipping' && case_.shippingDeliveryStatus === 'delivered';
  const released: EventInfo =
    case_.pickupStatus === 'released'
      ? { occurred: true, time: dateOnly(case_.pickupReleasedAt), source: 'case' }
      : delivered
        ? { occurred: true, time: dateOnly(case_.shippingDeliveredAt), source: 'case' }
        : NOT_OCCURRED;

  // Back with Manors: Date Received first (it has the date), then the
  // "Ashes picked up" tick (its completion record's time, when it has one),
  // or implied by the release. Never the Date of Cremation or the Expected
  // Pickup date.
  const receivedBack = dateOnly(case_.cremainsReceivedAt);
  const cremainsReceived = either(
    receivedBack ? { occurred: true, time: receivedBack, source: 'case' } : NOT_OCCURRED,
    fromChecklist('cremains_received'),
    released.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED,
  );
  // Ready at the crematory: recorded by staff, or necessarily true once the
  // cremains are back with Manors — but WHEN they were ready stays unknown.
  const cremainsReady = either(recorded('cremains_ready'), cremainsReceived.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED);
  const crematoryReceived = either(recorded('crematory_received'), cremainsReady.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED);
  const sentToCrematory = either(recorded('sent_to_crematory'), fromChecklist('sent_to_crematory'), crematoryReceived.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED);
  const permitSent = either(recorded('permit_sent'), fromChecklist('permit_sent'), sentToCrematory.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED);
  // State approval is satisfied ONLY by a recorded approval. A permit sent,
  // or anything later, is never treated as the approval itself.
  const approval = recorded('approval_received');
  const submittedRecorded = recorded('submitted_for_approval');
  // A recorded approval or submission implies the Hard Save happened (its
  // time stays unknown unless it was recorded itself).
  const hardSaved = either(recorded('hard_saved'), fromChecklist('hard_saved'), approval.occurred || submittedRecorded.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED);
  // Hard Save is the submission for state approval, unless a separate
  // submission time was recorded.
  const submitted = either(submittedRecorded, hardSaved.occurred ? { ...hardSaved } : NOT_OCCURRED);
  const attestation = either(recorded('attestation_received'), hardSaved.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED);
  const edrs = either(recorded('edrs_submitted'), fromChecklist('edrs_submitted'), attestation.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED);
  const caseReceived = either(recorded('case_received'), OCCURRED_TIME_UNKNOWN);

  const meRecord = case_.checklistCompletions?.[checklistItemKey(ME_VERIFIED_ITEM.displayStage, ME_VERIFIED_ITEM.index)];
  const meVerified: EventInfo =
    case_.isMedicalExaminerCase !== true
      ? NOT_OCCURRED
      : either(
          case_.checklistState[checklistItemKey(ME_VERIFIED_ITEM.displayStage, ME_VERIFIED_ITEM.index)] === true && meRecord?.done
            ? { occurred: true, time: meRecord.historical === true ? null : eventTimeFromIso(meRecord.at, calendar), source: 'checklist' }
            : NOT_OCCURRED,
          currentDisplayStage > ME_VERIFIED_ITEM.displayStage || approval.occurred ? OCCURRED_TIME_UNKNOWN : NOT_OCCURRED,
        );

  return {
    case_received: caseReceived,
    vital_statistics_received: recorded('vital_statistics_received'),
    edrs_submitted: edrs,
    attestation_received: attestation,
    hard_saved: hardSaved,
    submitted_for_approval: submitted,
    approval_received: approval,
    permit_sent: permitSent,
    sent_to_crematory: sentToCrematory,
    crematory_received: crematoryReceived,
    cremains_ready: cremainsReady,
    cremains_received: cremainsReceived,
    me_verified: meVerified,
    released,
  };
}

function activeDelay(case_: SlaCase, milestone: SlaMilestoneKey): SlaDelayRecord | null {
  const delays = Object.values(case_.slaDelays ?? {}).filter((delay) => delay.milestone === milestone && delay.resolvedAt === null);
  delays.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return delays[0] ?? null;
}

/** All delays recorded on a milestone, newest first (history included). */
export function delayHistory(case_: Pick<Case, 'slaDelays'>, milestone: SlaMilestoneKey): SlaDelayRecord[] {
  return Object.values(case_.slaDelays ?? {})
    .filter((delay) => delay.milestone === milestone)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

/** The deadline for a milestone started at `start`. */
function deadlineFor(definition: MilestoneDefinition, start: EventTime, settings: SlaSettings, calendar: BusinessCalendar): LocalDate {
  const from = effectiveStartDate(start, calendar, true);
  let deadline = addBusinessDays(from, definition.target(settings), calendar);
  if (definition.key === 'crematory_turnaround' && settings.crematoryReturnWeekdays.length > 0) {
    // A fixed weekly schedule: the first return day on or after the target.
    for (let guard = 0; guard < 14 && !(settings.crematoryReturnWeekdays.includes(weekdayOf(deadline)) && isBusinessDay(deadline, calendar)); guard++) {
      deadline = addCalendarDays(deadline, 1);
    }
  }
  return deadline;
}

/**
 * The SLA picture for one case at `nowIso`. Archived cases, and
 * organizations without SLA tracking, have none.
 */
export function evaluateCaseSla(case_: SlaCase, settings: SlaSettings, nowIso: string): CaseSlaEvaluation {
  if (!settings.enabled || case_.isDeleted) return EMPTY;
  const calendar = businessCalendarFor(settings);
  const now = localDateTime(nowIso, calendar.timezone);
  if (!now) return EMPTY;
  const events = resolveEvents(case_, calendar);
  const isMeCase = case_.isMedicalExaminerCase === true;

  const milestones = MILESTONES.map((definition): SlaMilestoneEvaluation => {
    const base = {
      key: definition.key,
      label: SLA_MILESTONE_LABEL[definition.key],
      responsibleParty: definition.responsible,
      advisory: definition.advisory === true,
      external: definition.responsible !== 'staff',
      delay: null,
      note: null,
      overdue: false,
      startedAt: null,
      completedAt: null,
      deadline: null,
      businessDaysRemaining: null,
    };
    if (definition.standardCaseOnly && isMeCase) return { ...base, state: 'not_applicable', status: null };

    const startKey = definition.key === 'approval' && isMeCase && !events.submitted_for_approval.occurred ? 'me_verified' : definition.start;
    const start = events[startKey];
    const stop = events[definition.stop];
    const delay = activeDelay(case_, definition.key);

    if (stop.occurred) {
      return { ...base, state: 'completed', status: 'completed', startedAt: start.time, completedAt: stop.time };
    }
    // An approval nobody recorded, on a case already sent to (or received
    // by) the crematory: say so, without treating it as met and without
    // holding the case on it. A case cannot go to the crematory without its
    // permit, so once it has, the approval wait is over even though its
    // time was never recorded — it must not keep counting as overdue
    // (2026-10: B2026-039/040 showed "State approval · 2 business days
    // overdue" while sitting at their last step).
    if (definition.key === 'approval' && (events.sent_to_crematory.occurred || events.crematory_received.occurred)) {
      return { ...base, state: 'not_recorded', status: null, startedAt: start.time, note: 'State approval was not recorded.' };
    }
    // A milestone with a crematory start: sent to the crematory, but no
    // receipt date recorded — the turnaround cannot be measured yet.
    const startPending = definition.key === 'crematory_turnaround' && !start.occurred && events.sent_to_crematory.occurred;
    if (!start.occurred && !startPending) return { ...base, state: 'not_started', status: null };
    if (!start.time) {
      const note =
        definition.key === 'family_pickup'
          ? 'Cremains are back with Manors, but the date received was not recorded. Add it as Date Received on the Schedule tab.'
          : null;
      return { ...base, state: 'start_date_needed', status: 'start_date_needed', delay, note };
    }

    const deadline = deadlineFor(definition, start.time, settings, calendar);
    let status: SlaStatus;
    let remaining: number;
    if (now.date < deadline) {
      remaining = businessDaysBetween(now.date, deadline, calendar);
      status = remaining <= settings.dueSoonBusinessDays ? 'due_soon' : 'on_track';
    } else if (now.date === deadline) {
      remaining = 0;
      status = now.minutes < calendar.closingMinutes ? 'due_today' : 'overdue';
    } else {
      remaining = -businessDaysBetween(deadline, now.date, calendar);
      status = 'overdue';
    }
    const overdue = status === 'overdue';
    let responsibleParty = definition.responsible;
    let note: string | null = null;

    // EDRS needs the family's paperwork. Without it, a missed deadline is
    // the family's wait, not a staff failure — the deadline stays as it was.
    if (definition.key === 'edrs_entry') {
      const paperwork = events.vital_statistics_received;
      if (!paperwork.occurred) {
        note = 'Family paperwork (Vital Statistics) not received yet.';
        if (overdue) {
          status = 'waiting_on_others';
          responsibleParty = 'family';
        }
      } else if (paperwork.time) {
        const days = Math.max(0, businessDaysBetween(paperwork.time.date, now.date, calendar));
        note = `Family paperwork received; information available to staff for ${days} business day${days === 1 ? '' : 's'}.`;
      }
    }

    if (delay) {
      status = SLA_DELAY_REASON_PARTY[delay.reason].status;
      responsibleParty = delay.responsibleParty;
    }

    return {
      ...base,
      state: 'active',
      status,
      overdue,
      responsibleParty,
      startedAt: start.time,
      deadline,
      businessDaysRemaining: remaining,
      delay,
      note,
    };
  });

  // The current milestone is the furthest one that is open. An earlier
  // milestone left open only because its time was never recorded is not the
  // current task once a LATER milestone has evidence of progress — it stays
  // visible, as it is, in the SLA details.
  const progressed = (milestone: SlaMilestoneEvaluation) => milestone.state !== 'not_started' && milestone.state !== 'not_applicable';
  // A milestone with a real deadline is genuinely open and stays current.
  const current =
    milestones.find(
      (milestone, index) =>
        milestone.state === 'active' || (milestone.state === 'start_date_needed' && !milestones.slice(index + 1).some(progressed)),
    ) ?? null;
  const entered = eventTimeFromIso(case_.stageEnteredAt ?? null, calendar);
  const businessDaysInStage = entered ? Math.max(0, businessDaysBetween(entered.date, now.date, calendar)) : null;

  const timeline: SlaEventTimelineEntry[] = [
    ...SLA_EVENT_KEYS.map((key) => ({ key, label: SLA_EVENT_LABEL[key], ...events[key] })),
    { key: 'cremains_received' as const, label: 'Cremains received by Manors', ...events.cremains_received },
    { key: 'released' as const, label: 'Released to family', ...events.released },
  ];
  return { enabled: true, milestones, current, businessDaysInStage, events: timeline };
}

/** One line for a deadline: "Due in 2 business days", "Due today", "3 business days overdue". */
export function describeDeadline(milestone: Pick<SlaMilestoneEvaluation, 'businessDaysRemaining' | 'overdue' | 'state'>): string {
  if (milestone.state === 'start_date_needed') return 'Start date needed';
  if (milestone.businessDaysRemaining === null) return '';
  const days = Math.abs(milestone.businessDaysRemaining);
  const unit = `business day${days === 1 ? '' : 's'}`;
  if (milestone.overdue) return days === 0 ? 'Overdue today' : `${days} ${unit} overdue`;
  if (milestone.businessDaysRemaining === 0) return 'Due today';
  return `Due in ${days} ${unit}`;
}

/** Dashboard summary bucket for a case's current milestone. */
export type SlaSummaryBucket = 'on_track' | 'due_today' | 'overdue' | 'waiting' | 'start_date_needed' | null;

export function slaSummaryBucket(current: SlaMilestoneEvaluation | null): SlaSummaryBucket {
  if (!current || !current.status) return null;
  switch (current.status) {
    case 'on_track':
    case 'due_soon':
      return 'on_track';
    case 'due_today':
      return 'due_today';
    case 'overdue':
      return 'overdue';
    case 'waiting_on_others':
    case 'exception_acknowledged':
      return 'waiting';
    case 'start_date_needed':
      return 'start_date_needed';
    default:
      return null;
  }
}

/** Whether the current milestone belongs in Needs Attention. */
export function slaNeedsAttention(current: SlaMilestoneEvaluation | null): boolean {
  if (!current || !current.status) return false;
  // A missing start date is shown on the case and counted on the dashboard,
  // but does not fill Needs Attention: every case that predates SLA
  // tracking starts out without one, and would bury the real deadlines.
  if (current.status === 'start_date_needed') return false;
  if (current.status === 'overdue' || current.status === 'due_today') return true;
  if (current.status === 'due_soon') return !current.external;
  // Someone else's wait or an acknowledged exception only needs attention
  // once its deadline has passed.
  return current.overdue;
}
