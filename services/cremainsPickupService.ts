import type { DataAdapterMode } from '../lib/env';
import type { Appointment } from '../types/appointment';
import type { Case } from '../types/case';
import type { ActivityContext } from './activityService';
import { isTerminalAppointmentStatus } from '../types/appointment';
import {
  EXPECTED_CREMAINS_PICKUP_TYPE,
  PICKUP_STATUS_LABEL,
  allDayWindowFor,
  expectedDateOf,
  isExpectedCremainsPickup,
  isManuallyDecided,
  resolvePickupStatus,
  type CremainsPickupStatus,
} from '../domain/scheduling/cremainsPickupPresentation';
import {
  calculateExpectedPickupDateFromInstant,
  organizationLocalDate,
  type LocalDate,
} from '../domain/scheduling/cremainsPickupSchedule';
import {
  resolveCremainsPickupSettings,
  type CremainsPickupSettings,
} from '../domain/organization/cremainsPickupCapability';
import { readChecklistValue } from '../domain/workflow/checklistItemKey';
import { createAppointment, completeAppointment } from './schedulingService';
import { getAppointment } from './scheduling/appointmentReads';

/**
 * Expected Cremains Pickup — orchestration (2026-10).
 *
 * Turns "the crematory paperwork is done" into exactly one calendar event
 * per case, and keeps that event honest as staff confirm, re-date, and
 * finally receive the cremains.
 *
 * WHY THERE IS NO NEW COLLECTION
 *
 * An expected pickup IS a scheduled operational event, so it is stored as
 * an ordinary `Appointment` of a new registry type. That inherits the
 * entire existing scheduling stack unchanged — organization-scoped reads,
 * the status state machine, reschedule/confirm/complete transitions, the
 * audit trail, calendar rendering, ICS export — instead of growing a
 * parallel one. Adding the type was a registry entry, exactly as
 * `appointmentTypeRegistry.ts`'s own header anticipates, so this feature
 * ships with no Wix schema migration at all.
 *
 * STATUS MAPPING onto the existing `AppointmentStatus` machine:
 *
 *   ESTIMATED  -> `scheduled`   automatically calculated, untouched
 *   CONFIRMED  -> `confirmed`   staff confirmed the date with the crematory
 *   RECEIVED   -> `completed`   cremains physically in hand (terminal)
 *   OVERDUE    -> DERIVED       expected date past and not yet received
 *
 * OVERDUE is deliberately never persisted. It is a pure function of the
 * expected date and receipt (see `isPickupOverdue`), so it cannot drift,
 * and — critically — the mere arrival of a date can never mutate a record
 * or advance a workflow. Nothing in this module runs on a timer.
 */

/**
 * The stable, case-scoped identity that makes every operation here
 * idempotent.
 *
 * One case has at most one expected pickup, so the appointment's id is
 * derived from the case id. A repeated save, an API retry, a webhook
 * redelivery, workflow reconciliation, or a page refresh all resolve to
 * this same id and therefore update rather than duplicate — the same
 * deterministic-id mechanism `externalFormSubmissions` and `caseFormLinks`
 * already use for idempotency in this codebase.
 */
export function expectedPickupAppointmentId(caseId: string): string {
  return `cremains-pickup-${caseId}`;
}






/**
 * Whether a case's paperwork stage is genuinely, fully complete.
 *
 * Completion of the TASK, never entry into the stage: every checklist item
 * in the configured stage must be checked. The stage is located by its
 * configured `displayStage` index, with the stage's own label from the
 * case's frozen `workflowSnapshot` used only as a SHAPE GUARD — if a
 * template is restructured so the label no longer matches, this returns
 * false and nothing is scheduled, rather than firing off whatever stage
 * now occupies that index.
 */
export function isPaperworkComplete(case_: Case, settings: CremainsPickupSettings): boolean {
  const snapshot = case_.workflowSnapshot;
  if (!snapshot) return false;

  const { displayStage, expectedLabel } = settings.paperworkStage;
  if (displayStage < 0) return false;

  const stages = snapshot.stages.filter((stage) => stage.displayStage === displayStage);
  if (stages.length === 0) return false;
  if (!stages.some((stage) => stage.label === expectedLabel)) return false;

  const items = stages[0].checklist.items;
  if (items.length === 0) return false;

  return items.every((_item, index) => readChecklistValue(case_.checklistState, displayStage, index) === true);
}

/** Whether the organization's own "cremains are here" checklist item is
    checked — the canonical receipt signal, guarded the same way. */
export function isReceiptItemChecked(case_: Case, settings: CremainsPickupSettings): boolean {
  const snapshot = case_.workflowSnapshot;
  if (!snapshot) return false;

  const { displayStage, index, expectedLabel } = settings.receiptChecklistItem;
  if (displayStage < 0 || index < 0) return false;

  const stage = snapshot.stages.find((s) => s.displayStage === displayStage);
  const item = stage?.checklist.items[index];
  if (!item || item.label !== expectedLabel) return false;

  return readChecklistValue(case_.checklistState, displayStage, index) === true;
}


export type SyncOutcome =
  | { action: 'created'; appointment: Appointment }
  | { action: 'updated'; appointment: Appointment }
  | { action: 'received'; appointment: Appointment }
  | { action: 'unchanged'; appointment: Appointment | null; reason: string };

/**
 * Reconciles a case's expected pickup with its current checklist state.
 *
 * Safe to call on every checklist save — it is idempotent, it never
 * creates a second event, and every path that could overwrite a human
 * decision is explicitly refused below.
 *
 * BEHAVIOR MATRIX
 *
 *   organization not configured ................ nothing, ever
 *   receipt item checked ....................... mark received (terminal)
 *   paperwork incomplete, pickup exists ........ LEAVE IT ALONE
 *   paperwork incomplete, no pickup ............ nothing
 *   paperwork complete, no pickup .............. create (ESTIMATED)
 *   paperwork complete, pickup is terminal ..... nothing (never resurrect)
 *   paperwork complete, human-decided .......... nothing (override wins)
 *   paperwork complete, auto, date changed ..... update the date
 *   paperwork complete, auto, same date ........ nothing
 *
 * UNCHECKING THE PAPERWORK TASK deliberately leaves an existing pickup in
 * place rather than deleting or cancelling it. Deleting would destroy a
 * scheduling record, which this codebase never does silently; cancelling
 * would hide a pickup that the crematory may well still be preparing. The
 * event stays visible and staff can re-date or cancel it explicitly — the
 * conservative choice, and the one consistent with "never silently delete
 * historical scheduling or receipt records."
 *
 * RE-CHECKING after an unchecking recalculates ONLY if the pickup is still
 * untouched automation; a confirmed or manually re-dated pickup is never
 * silently overwritten.
 */
/**
 * In-process coalescing of concurrent syncs for the SAME case.
 *
 * Two layers of concurrency protection, because they cover different
 * races:
 *   - Across processes/instances, the deterministic appointment id IS the
 *     Wix row id, so a second insert conflicts (409) and is caught below —
 *     the same durable mechanism `externalFormSubmissions` relies on.
 *   - Within one process, two overlapping requests for one case would both
 *     read "no pickup yet" before either wrote. This map makes the second
 *     await the first's result instead, so they cannot both create.
 * The entry is always removed in a `finally`, so a failure never wedges a
 * case permanently.
 */
const inFlightSyncs = new Map<string, Promise<SyncOutcome>>();

export async function syncExpectedPickupForCase(
  params: Parameters<typeof syncExpectedPickupForCaseUncoalesced>[0],
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<SyncOutcome> {
  const key = `${params.case_.organizationId}:${expectedPickupAppointmentId(params.case_.id)}`;
  const inFlight = inFlightSyncs.get(key);
  if (inFlight) return inFlight;

  const run = syncExpectedPickupForCaseUncoalesced(params, ctx, dataAdapterMode).finally(() => {
    inFlightSyncs.delete(key);
  });
  inFlightSyncs.set(key, run);
  return run;
}

async function syncExpectedPickupForCaseUncoalesced(
  params: {
    case_: Case;
    organization: { id: string; timezone?: string; cremainsPickupSettings?: unknown } | null;
    /** The instant the paperwork completed — normally "now", because this
        runs in the same request that persisted the checkbox. */
    paperworkCompletedAt: string;
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<SyncOutcome> {
  const { case_, organization, paperworkCompletedAt } = params;
  const now = params.now ?? new Date().toISOString();

  const settings = resolveCremainsPickupSettings(organization);
  if (!settings.automaticSchedulingEnabled) {
    return { action: 'unchanged', appointment: null, reason: 'organization_not_configured' };
  }

  const appointmentId = expectedPickupAppointmentId(case_.id);
  const existing = await getAppointment(case_.organizationId, appointmentId, dataAdapterMode);

  // Receipt first: once the cremains are physically here, nothing about
  // the expectation matters any more.
  if (isReceiptItemChecked(case_, settings)) {
    if (!existing) return { action: 'unchanged', appointment: null, reason: 'received_without_scheduled_pickup' };
    if (existing.status === 'completed') {
      return { action: 'unchanged', appointment: existing, reason: 'already_received' };
    }
    if (isTerminalAppointmentStatus(existing.status)) {
      return { action: 'unchanged', appointment: existing, reason: 'terminal_not_reopened' };
    }
    const received = await completeAppointment(case_.organizationId, appointmentId, 'completed', ctx, dataAdapterMode);
    return { action: 'received', appointment: received };
  }

  if (!isPaperworkComplete(case_, settings)) {
    // Includes the "task was unchecked" case — see the doc comment.
    return {
      action: 'unchanged',
      appointment: existing,
      reason: existing ? 'paperwork_incomplete_existing_pickup_preserved' : 'paperwork_incomplete',
    };
  }

  const expectedDate = calculateExpectedPickupDateFromInstant({
    paperworkCompletedAt,
    timezone: organization?.timezone,
    minimumProcessingDays: settings.minimumProcessingDays,
    allowedPickupWeekdays: settings.allowedPickupWeekdays,
  });
  if (!expectedDate) {
    return { action: 'unchanged', appointment: existing, reason: 'date_not_calculable' };
  }

  if (existing) {
    if (isTerminalAppointmentStatus(existing.status)) {
      return { action: 'unchanged', appointment: existing, reason: 'terminal_not_reopened' };
    }
    if (isManuallyDecided(existing)) {
      // A human's date always wins over the calculation.
      return { action: 'unchanged', appointment: existing, reason: 'manual_override_preserved' };
    }
    if (expectedDateOf(existing) === expectedDate) {
      return { action: 'unchanged', appointment: existing, reason: 'already_scheduled' };
    }
    const window = allDayWindowFor(expectedDate, organization?.timezone);
    const { rescheduleAppointment } = await import('./schedulingService');
    const updated = await rescheduleAppointment(
      case_.organizationId,
      appointmentId,
      window,
      // Recorded as the automation, not as the staff member who happened
      // to tick the box — so `isManuallyDecided` stays truthful.
      { ...ctx, actorIdentityId: null, isSystemGenerated: true },
      dataAdapterMode,
    );
    return { action: 'updated', appointment: updated };
  }

  const window = allDayWindowFor(expectedDate, organization?.timezone);
  try {
    const created = await createAppointment(
      {
        caseId: case_.id,
        appointmentType: EXPECTED_CREMAINS_PICKUP_TYPE,
        title: `Expected Cremains Pickup — ${case_.caseNumber}`,
        notes: `Automatically scheduled from completed crematory paperwork on ${
          organizationLocalDate(paperworkCompletedAt, organization?.timezone) ?? paperworkCompletedAt
        }.`,
        timezone: organization?.timezone || 'UTC',
        ...window,
        // A pickup books no room, vehicle, or staff member — it is a date to
        // watch, not a resource reservation. Without this it would land as
        // a draft; see NewAppointmentInput.
        schedulesWithoutResources: true,
        saveAsDraft: false,
        // Deterministic — this is the idempotency mechanism.
        idFactory: () => appointmentId,
        now,
      },
      {
        ...ctx,
        actorIdentityId: null,
        isSystemGenerated: true,
        correlationId: ctx.correlationId,
      },
      dataAdapterMode,
    );
    return { action: 'created', appointment: created };
  } catch (error) {
    // A concurrent writer won the deterministic-id insert. That is the
    // mechanism working, not a failure: re-read and report the pickup that
    // already exists rather than surfacing a conflict or creating a second.
    const raced = await getAppointment(case_.organizationId, appointmentId, dataAdapterMode);
    if (raced) return { action: 'unchanged', appointment: raced, reason: 'created_concurrently' };
    throw error;
  }
}

/** Every expected pickup for one organization, newest-first by date. */
export async function listExpectedPickups(
  organizationId: string,
  filters: { from?: string; to?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Appointment[]> {
  const { listAppointments } = await import('./scheduling/appointmentReads');
  const all = await listAppointments(organizationId, filters, dataAdapterMode);
  return all.filter(isExpectedCremainsPickup);
}

/** The outstanding list: everything not yet received, overdue included. */
export async function listOutstandingPickups(
  organizationId: string,
  organizationToday: LocalDate,
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Array<{ appointment: Appointment; status: CremainsPickupStatus }>> {
  const pickups = await listExpectedPickups(organizationId, {}, dataAdapterMode);
  return pickups
    .filter((a) => a.status !== 'completed' && a.status !== 'cancelled')
    .map((appointment) => ({ appointment, status: resolvePickupStatus(appointment, organizationToday) }));
}

// Re-exported so server callers keep one import site; the single
// implementation of each lives in the client-safe presentation module.
export {
  organizationLocalDate,
  EXPECTED_CREMAINS_PICKUP_TYPE,
  PICKUP_STATUS_LABEL,
  allDayWindowFor,
  expectedDateOf,
  isExpectedCremainsPickup,
  isManuallyDecided,
  resolvePickupStatus,
};
export type { CremainsPickupStatus };
