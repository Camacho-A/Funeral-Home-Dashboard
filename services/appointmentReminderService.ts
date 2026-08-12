import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixAppointmentReminderItem,
  buildWixAppointmentReminderData,
  applyAppointmentReminderUpdateToWixData,
  type WixAppointmentReminderItem,
} from '../lib/wixAppointmentReminderMapper';
import {
  mapWixSchedulingReminderPolicyItem,
  buildWixSchedulingReminderPolicyData,
  applySchedulingReminderPolicyUpdateToWixData,
  type WixSchedulingReminderPolicyItem,
} from '../lib/wixSchedulingReminderPolicyMapper';
import type { AppointmentReminder, ReminderRecipientType } from '../types/appointmentReminder';
import { DEFAULT_SCHEDULING_REMINDER_POLICY, type SchedulingReminderPolicy, type SchedulingReminderPolicyPatch } from '../types/schedulingReminderPolicy';
import type { Appointment } from '../types/appointment';
import { getAppointment } from './scheduling/appointmentReads';
import { assertStaffProfileIsActiveAndInOrganization, StaffAssignmentError } from './staffProfileService';
import { listActiveAccessForCase } from './portal/portalAccessService';
import { getForOrganization as getOrganizationForReminder } from './organizationsService';
import { createNotification } from './notificationService';
import { recordAppointmentReminderSent, recordAppointmentReminderFailed } from './activityService';
import { NOTIFICATION_TYPES } from '../domain/notifications/notificationTypeRegistry';
import { getAppBaseUrl } from '../lib/env';
import { formatAppointmentDate, formatAppointmentTime } from '../utils/scheduling';
import { appointmentReminderFixtures, schedulingReminderPolicyFixtures } from './__mocks__/schedulingReminderFixtures';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). The sole writer of `appointmentReminders` and
 * `schedulingReminderPolicies` — mirrors
 * `services/notificationDigestService.ts`'s own "thin, cron-triggered
 * orchestrator, one collection each fully owned by one file" shape.
 *
 * Called FROM `services/schedulingService.ts`'s existing lifecycle
 * functions (create/reschedule/cancel/complete, and the draft->scheduled
 * promotion in `updateAppointmentResources`) exactly the same way that
 * file already calls `notifyAppointmentOwner()` — never the reverse,
 * and this file never touches `Appointment`/`Resource`/
 * `RecurrenceDefinition` data itself. `schedulingService.ts` remains
 * the sole scheduling orchestration layer (invariant #4).
 *
 * This file only ever calls `notificationService.createNotification()`
 * for actual delivery — never a channel file, the recipient resolver,
 * or a notification collection directly (invariant #7, the same
 * containment `notificationDigestService.ts` already established).
 *
 * See docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md.
 */

const WIX_FETCH_WINDOW = 250;

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// SchedulingReminderPolicy — one row per organization, missing row = default
// ---------------------------------------------------------------------------

export async function getReminderPolicy(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<SchedulingReminderPolicy> {
  if (dataAdapterMode === 'mock') {
    const found = schedulingReminderPolicyFixtures.find((p) => p.organizationId === organizationId);
    return found ?? { organizationId, updatedAt: nowIso(), ...DEFAULT_SCHEDULING_REMINDER_POLICY };
  }
  const response = await queryWixDataItems<WixSchedulingReminderPolicyItem>('schedulingReminderPolicies', {
    filter: { organizationId },
    paging: { limit: 1 },
  });
  const mapped = mapWixSchedulingReminderPolicyItem(response.dataItems[0]?.data);
  return mapped ?? { organizationId, updatedAt: nowIso(), ...DEFAULT_SCHEDULING_REMINDER_POLICY };
}

export async function updateReminderPolicy(
  organizationId: string,
  patch: SchedulingReminderPolicyPatch,
  dataAdapterMode: DataAdapterMode,
): Promise<SchedulingReminderPolicy> {
  const now = nowIso();

  if (dataAdapterMode === 'mock') {
    const index = schedulingReminderPolicyFixtures.findIndex((p) => p.organizationId === organizationId);
    if (index === -1) {
      const created: SchedulingReminderPolicy = { organizationId, updatedAt: now, ...DEFAULT_SCHEDULING_REMINDER_POLICY, ...patch };
      schedulingReminderPolicyFixtures.push(created);
      return created;
    }
    schedulingReminderPolicyFixtures[index] = { ...schedulingReminderPolicyFixtures[index], ...patch, updatedAt: now };
    return schedulingReminderPolicyFixtures[index];
  }

  const response = await queryWixDataItems<WixSchedulingReminderPolicyItem>('schedulingReminderPolicies', {
    filter: { organizationId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) {
    const created: SchedulingReminderPolicy = { organizationId, updatedAt: now, ...DEFAULT_SCHEDULING_REMINDER_POLICY, ...patch };
    await insertWixDataItem<WixSchedulingReminderPolicyItem>('schedulingReminderPolicies', buildWixSchedulingReminderPolicyData(created), organizationId);
    return created;
  }
  const merged = applySchedulingReminderPolicyUpdateToWixData(existingItem.data, { ...patch, updatedAt: now });
  const updated = await updateWixDataItem<WixSchedulingReminderPolicyItem>('schedulingReminderPolicies', existingItem.id, merged);
  const mapped = mapWixSchedulingReminderPolicyItem(updated.data);
  if (!mapped) throw new Error('Failed to update scheduling reminder policy.');
  return mapped;
}

// ---------------------------------------------------------------------------
// AppointmentReminder persistence
// ---------------------------------------------------------------------------

async function findReminderById(id: string, dataAdapterMode: DataAdapterMode): Promise<AppointmentReminder | null> {
  if (dataAdapterMode === 'mock') {
    return appointmentReminderFixtures.find((r) => r.id === id) ?? null;
  }
  const response = await queryWixDataItems<WixAppointmentReminderItem>('appointmentReminders', {
    filter: { beaconAppointmentReminderId: id },
    paging: { limit: 1 },
  });
  return mapWixAppointmentReminderItem(response.dataItems[0]?.data);
}

async function insertReminder(reminder: AppointmentReminder, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    appointmentReminderFixtures.push(reminder);
    return;
  }
  await insertWixDataItem<WixAppointmentReminderItem>('appointmentReminders', buildWixAppointmentReminderData(reminder), reminder.id);
}

async function patchReminder(
  organizationId: string,
  id: string,
  patch: Partial<Pick<AppointmentReminder, 'status' | 'notificationId' | 'sentAt' | 'cancelledAt' | 'failureReason'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const now = nowIso();
  if (dataAdapterMode === 'mock') {
    const index = appointmentReminderFixtures.findIndex((r) => r.id === id && r.organizationId === organizationId);
    if (index === -1) return;
    appointmentReminderFixtures[index] = { ...appointmentReminderFixtures[index], ...patch, updatedAt: now };
    return;
  }
  const response = await queryWixDataItems<WixAppointmentReminderItem>('appointmentReminders', {
    filter: { organizationId, beaconAppointmentReminderId: id },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const merged = applyAppointmentReminderUpdateToWixData(existingItem.data, { ...patch, updatedAt: now });
  await updateWixDataItem<WixAppointmentReminderItem>('appointmentReminders', existingItem.id, merged);
}

// ---------------------------------------------------------------------------
// Recipient resolution — real identity relationships only (see plan §6)
// ---------------------------------------------------------------------------

/** Null if there's no owner at all (not an error — "no owner" is a
    valid outcome, mirrors schedulingService.ts's own
    notifyAppointmentOwner). 'ineligible' if an owner IS assigned but
    fails the active-StaffProfile/active-Membership check — the
    anomalous case a 'skipped' row should record for visibility. */
async function resolveStaffOwnerRecipient(appointment: Appointment, dataAdapterMode: DataAdapterMode): Promise<{ identityId: string } | 'ineligible' | null> {
  if (!appointment.ownerStaffProfileId) return null;
  try {
    const profile = await assertStaffProfileIsActiveAndInOrganization(appointment.organizationId, appointment.ownerStaffProfileId, dataAdapterMode);
    return { identityId: profile.identityId };
  } catch (error) {
    if (error instanceof StaffAssignmentError) return 'ineligible';
    throw error;
  }
}

/** One entry per active PortalAccess grant carrying appointment.read for
    the appointment's case — never a single "primary contact" guess. */
async function resolveFamilyRecipients(appointment: Appointment, dataAdapterMode: DataAdapterMode): Promise<string[]> {
  if (!appointment.caseId) return [];
  const grants = await listActiveAccessForCase(appointment.organizationId, appointment.caseId, 'appointment.read', dataAdapterMode);
  return grants.map((g) => g.portalUserId).filter((id): id is string => id !== null);
}

type ReminderTarget = { recipientType: ReminderRecipientType; recipientIdentityId: string | null; recipientPortalUserId: string | null; status: 'scheduled' | 'skipped' };

async function resolveReminderTargets(appointment: Appointment, policy: SchedulingReminderPolicy, dataAdapterMode: DataAdapterMode): Promise<ReminderTarget[]> {
  const targets: ReminderTarget[] = [];

  if (policy.notifyOwner) {
    const owner = await resolveStaffOwnerRecipient(appointment, dataAdapterMode);
    if (owner === 'ineligible') {
      targets.push({ recipientType: 'staff_owner', recipientIdentityId: null, recipientPortalUserId: null, status: 'skipped' });
    } else if (owner) {
      targets.push({ recipientType: 'staff_owner', recipientIdentityId: owner.identityId, recipientPortalUserId: null, status: 'scheduled' });
    }
  }

  if (policy.notifyFamily) {
    const portalUserIds = await resolveFamilyRecipients(appointment, dataAdapterMode);
    for (const portalUserId of portalUserIds) {
      targets.push({ recipientType: 'family_portal_user', recipientIdentityId: null, recipientPortalUserId: portalUserId, status: 'scheduled' });
    }
  }

  return targets;
}

function reminderId(appointmentId: string, leadTimeMinutes: number, target: ReminderTarget): string {
  const recipientRef = target.recipientType === 'staff_owner' ? target.recipientIdentityId ?? 'ineligible' : (target.recipientPortalUserId as string);
  return `${appointmentId}-${leadTimeMinutes}-${target.recipientType}-${recipientRef}`;
}

/** A row is only ever (re)activated to 'scheduled' if it doesn't exist
    yet, or if its current status is 'scheduled'/'cancelled' — the two
    states a reschedule's own cancel-then-reschedule flow can leave it
    in. A row already 'sent'/'skipped'/'failed' is a genuinely terminal
    outcome and is deliberately left untouched, never silently
    resurrected — see this file's own header comment on why a
    reschedule after a reminder already fired doesn't retroactively
    re-fire it (a disclosed, accepted limitation, not an oversight). */
async function upsertReminderRow(
  organizationId: string,
  appointmentId: string,
  leadTimeMinutes: number,
  target: ReminderTarget,
  scheduledFor: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const id = reminderId(appointmentId, leadTimeMinutes, target);
  const now = nowIso();
  const existing = await findReminderById(id, dataAdapterMode);

  if (!existing) {
    await insertReminder(
      {
        id,
        organizationId,
        appointmentId,
        leadTimeMinutes,
        recipientType: target.recipientType,
        recipientIdentityId: target.recipientIdentityId,
        recipientPortalUserId: target.recipientPortalUserId,
        scheduledFor,
        status: target.status,
        notificationId: null,
        sentAt: null,
        cancelledAt: null,
        failureReason: target.status === 'skipped' ? 'Appointment owner is not an active staff member.' : null,
        createdAt: now,
        updatedAt: now,
      },
      dataAdapterMode,
    );
    return;
  }

  if (existing.status === 'scheduled' || existing.status === 'cancelled') {
    // Reactivate in place for the new schedule — same logical reminder,
    // never a duplicate row. cancelledAt cleared since it's live again.
    if (dataAdapterMode === 'mock') {
      const index = appointmentReminderFixtures.findIndex((r) => r.id === id);
      appointmentReminderFixtures[index] = { ...appointmentReminderFixtures[index], scheduledFor, status: target.status, cancelledAt: null, updatedAt: now };
      return;
    }
    const response = await queryWixDataItems<WixAppointmentReminderItem>('appointmentReminders', {
      filter: { organizationId, beaconAppointmentReminderId: id },
      paging: { limit: 1 },
    });
    const existingItem = response.dataItems[0];
    if (!existingItem) return;
    const merged = applyAppointmentReminderUpdateToWixData(existingItem.data, { status: target.status, cancelledAt: null, updatedAt: now });
    // scheduledFor isn't covered by applyAppointmentReminderUpdateToWixData's
    // narrow patch surface (deliberately immutable-looking elsewhere) — set
    // it directly here, the one field a reschedule genuinely needs to move.
    (merged as WixAppointmentReminderItem).scheduledFor = scheduledFor;
    await updateWixDataItem<WixAppointmentReminderItem>('appointmentReminders', existingItem.id, merged);
  }
  // else: 'sent' | 'skipped' | 'failed' — terminal, left untouched.
}

// ---------------------------------------------------------------------------
// Lifecycle hooks — called from services/schedulingService.ts
// ---------------------------------------------------------------------------

/** Called after an appointment is created (non-draft) or promoted from
    draft to scheduled — never for a still-draft appointment. */
export async function scheduleRemindersForAppointment(appointment: Appointment, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (appointment.status === 'draft') return;

  const policy = await getReminderPolicy(appointment.organizationId, dataAdapterMode);
  if (policy.leadTimesMinutes.length === 0) return;

  const targets = await resolveReminderTargets(appointment, policy, dataAdapterMode);
  if (targets.length === 0) return;

  for (const leadTimeMinutes of policy.leadTimesMinutes) {
    const scheduledFor = new Date(new Date(appointment.startAt).getTime() - leadTimeMinutes * 60_000).toISOString();
    for (const target of targets) {
      await upsertReminderRow(appointment.organizationId, appointment.id, leadTimeMinutes, target, scheduledFor, dataAdapterMode);
    }
  }
}

/** Cancels every still-'scheduled' reminder for this appointment —
    called on cancel/complete (terminal, no reschedule follows) and as
    the first half of a reschedule (immediately followed by
    scheduleRemindersForAppointment, which reactivates these same rows
    against the new time — see upsertReminderRow's own comment). */
export async function cancelRemindersForAppointment(organizationId: string, appointmentId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  const now = nowIso();
  if (dataAdapterMode === 'mock') {
    for (const reminder of appointmentReminderFixtures.filter((r) => r.organizationId === organizationId && r.appointmentId === appointmentId && r.status === 'scheduled')) {
      await patchReminder(organizationId, reminder.id, { status: 'cancelled', cancelledAt: now }, dataAdapterMode);
    }
    return;
  }
  const response = await queryWixDataItems<WixAppointmentReminderItem>('appointmentReminders', {
    filter: { organizationId, appointmentId, status: 'scheduled' },
    paging: { limit: WIX_FETCH_WINDOW },
  });
  const reminders = response.dataItems.map((item) => mapWixAppointmentReminderItem(item.data)).filter((r): r is AppointmentReminder => r !== null);
  for (const reminder of reminders) {
    await patchReminder(organizationId, reminder.id, { status: 'cancelled', cancelledAt: now }, dataAdapterMode);
  }
}

/** Reschedule = cancel every currently-scheduled reminder, then
    re-derive targets/lead-times against the appointment's new startAt.
    Thanks to upsertReminderRow's reactivation behavior, this never
    leaves an obsolete (stale-time) reminder active. */
export async function rescheduleRemindersForAppointment(appointment: Appointment, dataAdapterMode: DataAdapterMode): Promise<void> {
  await cancelRemindersForAppointment(appointment.organizationId, appointment.id, dataAdapterMode);
  await scheduleRemindersForAppointment(appointment, dataAdapterMode);
}

// ---------------------------------------------------------------------------
// Reminder sweep support (Phase 34) — the sole, deliberate second
// instance of "every query in this codebase is organization-scoped"
// being relaxed for a genuinely system-level cron job. Mirrors
// notificationService.ts's own equivalent digest-sweep query exactly —
// org-agnostic, bounded, and structurally contained to the one sweep
// function below (see notificationService.test.ts's own precedent for
// the shape of the containing structural test this file gets too).
// ---------------------------------------------------------------------------

async function listDueReminders(nowIsoValue: string, dataAdapterMode: DataAdapterMode): Promise<AppointmentReminder[]> {
  if (dataAdapterMode === 'mock') {
    return appointmentReminderFixtures.filter((r) => r.status === 'scheduled' && r.scheduledFor <= nowIsoValue).slice(0, WIX_FETCH_WINDOW);
  }
  const response = await queryWixDataItems<WixAppointmentReminderItem>('appointmentReminders', {
    filter: { status: 'scheduled' },
    paging: { limit: WIX_FETCH_WINDOW },
  });
  return response.dataItems
    .map((item) => mapWixAppointmentReminderItem(item.data))
    .filter((r): r is AppointmentReminder => r !== null && r.scheduledFor <= nowIsoValue);
}

export type AppointmentReminderSweepResult = {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
};

/** One notification per due reminder — resolves the recipient's current
    email address for the appointmentStartAt token via the appointment's
    own timezone (org-local formatting, matching
    domain/notifications/digestTiming.ts's own "format in the org's
    timezone, never the server's" discipline), then delegates entirely
    to notificationService.createNotification — preferences, category
    overrides, channel selection, delivery-status persistence, and
    provider-failure honesty are all inherited from there, never
    reimplemented here. */
export async function runAppointmentReminderSweep(dataAdapterMode: DataAdapterMode, now?: string): Promise<AppointmentReminderSweepResult> {
  const nowIsoValue = now ?? nowIso();
  const due = await listDueReminders(nowIsoValue, dataAdapterMode);

  const result: AppointmentReminderSweepResult = { considered: due.length, sent: 0, skipped: 0, failed: 0 };

  for (const reminder of due) {
    await processReminder(reminder, nowIsoValue, dataAdapterMode, result);
  }

  return result;
}

async function processReminder(reminder: AppointmentReminder, nowIsoValue: string, dataAdapterMode: DataAdapterMode, result: AppointmentReminderSweepResult): Promise<void> {
  const appointment = await getAppointment(reminder.organizationId, reminder.appointmentId, dataAdapterMode);

  // Defense in depth — the lifecycle hooks already cancel reminders on
  // cancel/complete, so this should be rare; a terminal/missing
  // appointment here means those hooks somehow didn't run (or ran
  // between the sweep's own read and write, a genuinely narrow race).
  if (!appointment || appointment.status === 'cancelled' || appointment.status === 'completed' || appointment.status === 'no_show') {
    await patchReminder(reminder.organizationId, reminder.id, { status: 'skipped', failureReason: 'Appointment no longer active.' }, dataAdapterMode);
    result.skipped += 1;
    return;
  }

  try {
    const organization = await getOrganizationForReminder(reminder.organizationId, dataAdapterMode);
    const timezone = appointment.timezone || organization?.timezone;
    const appointmentStartAt = `${formatAppointmentDate(appointment.startAt, timezone || 'UTC')}, ${formatAppointmentTime(appointment.startAt, timezone || 'UTC')}`;

    const notificationType = reminder.recipientType === 'staff_owner' ? NOTIFICATION_TYPES.APPOINTMENT_REMINDER.key : NOTIFICATION_TYPES.FAMILY_APPOINTMENT_REMINDER.key;

    const ctx = { organizationId: reminder.organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: reminder.id, isSystemGenerated: true };
    const notification = await createNotification(
      {
        notificationType,
        entityType: 'appointment',
        entityId: appointment.id,
        recipientScope: reminder.recipientType === 'staff_owner' ? 'individual' : 'portal_user',
        recipientIdentityId: reminder.recipientIdentityId ?? undefined,
        recipientPortalUserId: reminder.recipientPortalUserId ?? undefined,
        caseId: appointment.caseId ?? undefined,
        actionUrl: `${getAppBaseUrl()}/dashboard`,
        tokens: { entityTitle: appointment.title, appointmentStartAt },
        idFactory: () => crypto.randomUUID(),
        now: nowIsoValue,
      },
      ctx,
      dataAdapterMode,
    );

    await patchReminder(reminder.organizationId, reminder.id, { status: 'sent', notificationId: notification.id, sentAt: nowIsoValue }, dataAdapterMode);
    result.sent += 1;
    try {
      await recordAppointmentReminderSent(ctx, appointment.caseId, appointment.id, reminder.id, dataAdapterMode);
    } catch (activityError) {
      console.error('Failed to record scheduling.appointment.reminder_sent activity event:', activityError instanceof Error ? activityError.message : activityError);
    }
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    await patchReminder(reminder.organizationId, reminder.id, { status: 'failed', failureReason }, dataAdapterMode);
    result.failed += 1;
    try {
      await recordAppointmentReminderFailed(
        { organizationId: reminder.organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: reminder.id, isSystemGenerated: true },
        appointment?.caseId ?? null,
        reminder.appointmentId,
        reminder.id,
        failureReason,
        dataAdapterMode,
      );
    } catch (activityError) {
      console.error('Failed to record scheduling.appointment.reminder_failed activity event:', activityError instanceof Error ? activityError.message : activityError);
    }
  }
}
