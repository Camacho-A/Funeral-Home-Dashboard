import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, deleteWixDataItem } from '../lib/wixDataApi';
import {
  mapWixCalendarEventLinkItem,
  buildWixCalendarEventLinkData,
  applyCalendarEventLinkUpdateToWixData,
  type WixCalendarEventLinkItem,
} from '../lib/wixCalendarEventLinkMapper';
import type { CalendarEventLink } from '../types/calendarEventLink';
import type { Appointment } from '../types/appointment';
import type { CalendarConnection, CalendarProviderName } from '../types/calendarConnection';
import { getAppointment } from './scheduling/appointmentReads';
import { getConnectionById, listActiveConnectionsForStaffProfile, getValidAccessToken } from './calendarConnectionService';
import { getById as getStaffProfileById } from './staffProfileService';
import type { CalendarProvider, CalendarEventDraft } from './calendar/calendarProvider';
import { CalendarProviderError } from './calendar/calendarProvider';
import { googleCalendarProvider } from './calendar/googleCalendarProvider';
import { microsoftCalendarProvider } from './calendar/microsoftCalendarProvider';
import { createNotification } from './notificationService';
import { NOTIFICATION_TYPES } from '../domain/notifications/notificationTypeRegistry';
import { recordCalendarSyncFailed } from './activityService';
import { getAppBaseUrl } from '../lib/env';
import { calendarEventLinkFixtures } from './__mocks__/calendarFixtures';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). The sole writer of `calendarEventLinks` — mirrors
 * `appointmentReminderService.ts`'s own "thin, cron-swept orchestrator,
 * one collection fully owned by one file" shape. Alongside
 * `calendarConnectionService.ts`, the only file that imports
 * `googleCalendarProvider.ts`/`microsoftCalendarProvider.ts` directly
 * (structurally enforced — see this file's own structural test);
 * `schedulingService.ts` and every UI component reach neither provider
 * nor this file's own sweep query directly.
 *
 * One-way sync only (Beacon -> external calendar): the functions called
 * from `schedulingService.ts` (`markPendingForAppointment`/
 * `markPendingForCancellation`) NEVER call a provider — they only ever
 * write a `calendarEventLinks` row with `syncStatus: 'pending'`, a
 * cheap same-Wix-transaction-class operation identical in cost/risk to
 * the pre-existing `notifyAppointmentOwner()`/`syncReminders()` calls
 * `schedulingService.ts` already makes. The actual external HTTP call
 * happens exclusively inside `runCalendarSyncSweep`, triggered by
 * `app/api/cron/calendar-sync/route.ts` in a separate request entirely
 * — see docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md.
 */

function nowIso(): string {
  return new Date().toISOString();
}

function getProviderAdapter(provider: CalendarProviderName): CalendarProvider {
  return provider === 'google' ? googleCalendarProvider : microsoftCalendarProvider;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function findLinkById(id: string, dataAdapterMode: DataAdapterMode): Promise<CalendarEventLink | null> {
  if (dataAdapterMode === 'mock') {
    return calendarEventLinkFixtures.find((l) => l.id === id) ?? null;
  }
  const response = await queryWixDataItems<WixCalendarEventLinkItem>('calendarEventLinks', { filter: { beaconCalendarEventLinkId: id }, paging: { limit: 1 } });
  return mapWixCalendarEventLinkItem(response.dataItems[0]?.data);
}

async function upsertLink(link: CalendarEventLink, dataAdapterMode: DataAdapterMode): Promise<CalendarEventLink> {
  const existing = await findLinkById(link.id, dataAdapterMode);

  if (dataAdapterMode === 'mock') {
    if (existing) {
      const index = calendarEventLinkFixtures.findIndex((l) => l.id === link.id);
      calendarEventLinkFixtures[index] = link;
    } else {
      calendarEventLinkFixtures.push(link);
    }
    return link;
  }

  if (existing) {
    const response = await queryWixDataItems<WixCalendarEventLinkItem>('calendarEventLinks', { filter: { beaconCalendarEventLinkId: link.id }, paging: { limit: 1 } });
    const existingItem = response.dataItems[0];
    if (!existingItem) throw new Error('Failed to locate calendar event link for update.');
    const merged = applyCalendarEventLinkUpdateToWixData(existingItem.data, link);
    await updateWixDataItem<WixCalendarEventLinkItem>('calendarEventLinks', existingItem.id, merged);
    return link;
  }

  await insertWixDataItem<WixCalendarEventLinkItem>('calendarEventLinks', buildWixCalendarEventLinkData(link), link.id);
  return link;
}

async function patchLink(
  organizationId: string,
  id: string,
  patch: Partial<Pick<CalendarEventLink, 'externalEventId' | 'syncStatus' | 'beaconAppointmentVersion' | 'lastSyncedAt' | 'lastError' | 'retryCount' | 'updatedAt'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = calendarEventLinkFixtures.findIndex((l) => l.id === id && l.organizationId === organizationId);
    if (index === -1) return; // already gone (e.g. deleted by a concurrent sweep tick) — nothing to patch
    calendarEventLinkFixtures[index] = { ...calendarEventLinkFixtures[index], ...patch };
    return;
  }
  const response = await queryWixDataItems<WixCalendarEventLinkItem>('calendarEventLinks', { filter: { organizationId, beaconCalendarEventLinkId: id }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const merged = applyCalendarEventLinkUpdateToWixData(existingItem.data, patch);
  await updateWixDataItem<WixCalendarEventLinkItem>('calendarEventLinks', existingItem.id, merged);
}

async function deleteLinkRow(organizationId: string, id: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = calendarEventLinkFixtures.findIndex((l) => l.id === id && l.organizationId === organizationId);
    if (index !== -1) calendarEventLinkFixtures.splice(index, 1);
    return;
  }
  const response = await queryWixDataItems<WixCalendarEventLinkItem>('calendarEventLinks', { filter: { organizationId, beaconCalendarEventLinkId: id }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  await deleteWixDataItem('calendarEventLinks', existingItem.id);
}

export async function listLinksForAppointment(organizationId: string, appointmentId: string, dataAdapterMode: DataAdapterMode): Promise<CalendarEventLink[]> {
  if (dataAdapterMode === 'mock') {
    return calendarEventLinkFixtures.filter((l) => l.organizationId === organizationId && l.appointmentId === appointmentId);
  }
  const response = await queryWixDataItems<WixCalendarEventLinkItem>('calendarEventLinks', { filter: { organizationId, appointmentId } });
  return response.dataItems.map((item) => mapWixCalendarEventLinkItem(item.data)).filter((l): l is CalendarEventLink => l !== null);
}

/** Every link in the organization — the Calendar page's own sync-status
    indicator fetches this once alongside its existing appointments
    query (never a second polling loop) and derives each visible
    appointment's badge from it client-side. */
export async function listLinksForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<CalendarEventLink[]> {
  if (dataAdapterMode === 'mock') {
    return calendarEventLinkFixtures.filter((l) => l.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixCalendarEventLinkItem>('calendarEventLinks', { filter: { organizationId } });
  return response.dataItems.map((item) => mapWixCalendarEventLinkItem(item.data)).filter((l): l is CalendarEventLink => l !== null);
}

// ---------------------------------------------------------------------------
// Write-side — called from schedulingService.ts. Never calls a provider.
// ---------------------------------------------------------------------------

/**
 * Marks (creating if needed) a `pending` link for every active
 * connection the appointment's owner currently has — called from
 * `schedulingService.ts` on create/reschedule/resource-change and on
 * the draft->scheduled promotion. Idempotent via the deterministic
 * `${appointmentId}-${calendarConnectionId}` id: a second call for the
 * same (appointment, connection) pair upserts the existing row rather
 * than creating a duplicate, and re-marks an already-`synced` link back
 * to `pending` so the sweep re-pushes the appointment's current state.
 * A `retry_pending`/`failed` link's `retryCount` is reset to 0 — a
 * fresh trigger supersedes whatever backoff was in progress for the
 * previous (now stale) desired state.
 *
 * No owner, or no active connection for that owner, is a silent no-op
 * — exactly matching `appointmentReminderService.ts`'s own "no owner is
 * a valid, non-error outcome" posture (§6 of the plan).
 */
export async function markPendingForAppointment(appointment: Appointment, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (!appointment.ownerStaffProfileId) return;
  const connections = await listActiveConnectionsForStaffProfile(appointment.organizationId, appointment.ownerStaffProfileId, dataAdapterMode);
  for (const connection of connections) {
    await upsertPendingLink(appointment, connection, dataAdapterMode);
  }
}

async function upsertPendingLink(appointment: Appointment, connection: CalendarConnection, dataAdapterMode: DataAdapterMode): Promise<void> {
  const id = `${appointment.id}-${connection.id}`;
  const existing = await findLinkById(id, dataAdapterMode);
  const now = nowIso();
  const link: CalendarEventLink = {
    id,
    organizationId: appointment.organizationId,
    appointmentId: appointment.id,
    calendarConnectionId: connection.id,
    provider: connection.provider,
    externalCalendarId: connection.externalCalendarId,
    externalEventId: existing?.externalEventId ?? null,
    syncStatus: 'pending',
    beaconAppointmentVersion: existing?.beaconAppointmentVersion ?? 0,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    lastError: existing?.lastError ?? null,
    retryCount: 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await upsertLink(link, dataAdapterMode);
}

/**
 * Marks every existing link for this appointment `pending` again (a
 * delete-intent, not a push) — called only from
 * `schedulingService.ts#cancelAppointment`. The sweep, seeing the live
 * `Appointment.status === 'cancelled'`, deletes the external event (if
 * one was ever created) and then deletes the link row itself — a row
 * existing always means an external event exists or is pending, never
 * a terminal "deleted" status left lying around. An appointment with no
 * existing link (no owner, or owner never connected a calendar) is a
 * no-op. `completeAppointment`/no-show deliberately do NOT call this —
 * the external event is left exactly as-is once an appointment has
 * actually happened, matching how a real calendar naturally retains
 * past events (§16 of the plan, a decision, not an oversight).
 */
export async function markPendingForCancellation(organizationId: string, appointmentId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  const links = await listLinksForAppointment(organizationId, appointmentId, dataAdapterMode);
  for (const link of links) {
    if (link.syncStatus === 'disconnected') continue; // never retried — see runCalendarSyncSweep's own comment
    await patchLink(organizationId, link.id, { syncStatus: 'pending', retryCount: 0, updatedAt: nowIso() }, dataAdapterMode);
  }
}

// ---------------------------------------------------------------------------
// Sweep — the ONLY place a provider is ever called. Cron-triggered only.
// ---------------------------------------------------------------------------

const WIX_FETCH_WINDOW = 250; // mirrors appointmentReminderService.ts's own sweep bound

/** Bounded exponential backoff by `retryCount`: 1m, 5m, 30m, 4h, 24h —
    beyond `MAX_RETRY_COUNT` attempts the link flips permanently to
    `failed` and a one-time notification fires (never on every transient
    retry — see `recordSyncFailure`). */
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 4 * 3600_000, 24 * 3600_000];
const MAX_RETRY_COUNT = 5;

function isRetryDue(link: CalendarEventLink, nowMs: number): boolean {
  if (link.syncStatus === 'pending') return true;
  const backoffMs = RETRY_BACKOFF_MS[Math.min(link.retryCount, RETRY_BACKOFF_MS.length - 1)];
  return nowMs - new Date(link.updatedAt).getTime() >= backoffMs;
}

/**
 * Wix Data has no `IN`-filter support (confirmed negative, Phase 22) —
 * two single-value queries for `'pending'`/`'retry_pending'`, merged and
 * capped in-process, exactly the same workaround shape this codebase
 * already uses wherever a multi-value Wix filter would otherwise be
 * needed. Org-agnostic — the sweep's one deliberate exception (a cron
 * job has no per-request organization to scope to), mirroring
 * `appointmentReminderService.ts#listDueReminders`'s own documented
 * exception and structurally contained to this one call site.
 */
async function listSweepCandidates(dataAdapterMode: DataAdapterMode): Promise<CalendarEventLink[]> {
  if (dataAdapterMode === 'mock') {
    return calendarEventLinkFixtures.filter((l) => l.syncStatus === 'pending' || l.syncStatus === 'retry_pending').slice(0, WIX_FETCH_WINDOW);
  }
  const [pending, retryPending] = await Promise.all([
    queryWixDataItems<WixCalendarEventLinkItem>('calendarEventLinks', { filter: { syncStatus: 'pending' }, paging: { limit: WIX_FETCH_WINDOW } }),
    queryWixDataItems<WixCalendarEventLinkItem>('calendarEventLinks', { filter: { syncStatus: 'retry_pending' }, paging: { limit: WIX_FETCH_WINDOW } }),
  ]);
  return [...pending.dataItems, ...retryPending.dataItems]
    .map((item) => mapWixCalendarEventLinkItem(item.data))
    .filter((l): l is CalendarEventLink => l !== null)
    .slice(0, WIX_FETCH_WINDOW);
}

function buildEventDraft(appointment: Appointment): CalendarEventDraft {
  return {
    title: appointment.title,
    // Staff-facing sync only — notes may include internal detail never
    // shown on the family side (matches the plan's own staff/family ICS
    // DTO split, §9). Real address-text resolution from
    // Appointment.locationId is deferred to the ICS work (task #362) —
    // never fabricated here.
    description: appointment.notes ?? '',
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    location: null,
    timezone: appointment.timezone,
  };
}

async function processLink(link: CalendarEventLink, dataAdapterMode: DataAdapterMode): Promise<void> {
  const connection = await getConnectionById(link.organizationId, link.calendarConnectionId, dataAdapterMode);
  if (!connection || connection.status !== 'connected') {
    // Lazy detection, at sweep time, of a connection that is no longer
    // `connected` (disconnected, reauth_required, or error) — deliberately
    // not an eager write from calendarConnectionService.ts#disconnect,
    // which would require that file to depend back on this one
    // (calendarSyncService already depends on calendarConnectionService
    // for connection/token access). Never retried once here (§16).
    await patchLink(link.organizationId, link.id, { syncStatus: 'disconnected', updatedAt: nowIso() }, dataAdapterMode);
    return;
  }

  const appointment = await getAppointment(link.organizationId, link.appointmentId, dataAdapterMode);
  if (!appointment) {
    // Unreachable in practice — Appointments are never hard-deleted in
    // this codebase — handled defensively rather than assumed away.
    await deleteLinkRow(link.organizationId, link.id, dataAdapterMode);
    return;
  }

  try {
    const { accessToken } = await getValidAccessToken(connection, dataAdapterMode);
    const adapter = getProviderAdapter(link.provider);

    if (appointment.status === 'cancelled') {
      if (link.externalEventId) {
        await adapter.deleteEvent(accessToken, { externalCalendarId: link.externalCalendarId, externalEventId: link.externalEventId });
      }
      await deleteLinkRow(link.organizationId, link.id, dataAdapterMode);
      return;
    }

    const draft = buildEventDraft(appointment);
    let externalEventId = link.externalEventId;
    if (externalEventId) {
      await adapter.updateEvent(accessToken, { externalCalendarId: link.externalCalendarId, externalEventId }, draft);
    } else {
      const ref = await adapter.createEvent(accessToken, link.externalCalendarId, draft);
      externalEventId = ref.externalEventId;
    }

    await patchLink(
      link.organizationId,
      link.id,
      { syncStatus: 'synced', externalEventId, beaconAppointmentVersion: appointment.appointmentVersion, lastSyncedAt: nowIso(), lastError: null, retryCount: 0, updatedAt: nowIso() },
      dataAdapterMode,
    );
  } catch (error) {
    await recordSyncFailure(link, error, dataAdapterMode);
  }
}

async function recordSyncFailure(link: CalendarEventLink, error: unknown, dataAdapterMode: DataAdapterMode): Promise<void> {
  const message = (error instanceof CalendarProviderError || error instanceof Error ? error.message : String(error)).slice(0, 500);
  const nextRetryCount = link.retryCount + 1;
  const now = nowIso();

  if (nextRetryCount > MAX_RETRY_COUNT) {
    await patchLink(link.organizationId, link.id, { syncStatus: 'failed', lastError: message, retryCount: nextRetryCount, updatedAt: now }, dataAdapterMode);
    await notifySyncFailed(link, dataAdapterMode);
    return;
  }
  await patchLink(link.organizationId, link.id, { syncStatus: 'retry_pending', lastError: message, retryCount: nextRetryCount, updatedAt: now }, dataAdapterMode);
}

/** Fires exactly once, on the `retry_pending -> failed` terminal
    transition — never on every transient retry, matching the reminder
    sweep's own "actionable failures only" discipline (§17/§20 of the
    plan). Best-effort: a notification failure here must never re-throw
    into the sweep loop and abandon the rest of the batch. */
async function notifySyncFailed(link: CalendarEventLink, dataAdapterMode: DataAdapterMode): Promise<void> {
  try {
    const connection = await getConnectionById(link.organizationId, link.calendarConnectionId, dataAdapterMode);
    if (!connection) return;
    const staffProfile = await getStaffProfileById(link.organizationId, connection.staffProfileId, dataAdapterMode);
    if (!staffProfile) return;
    const appointment = await getAppointment(link.organizationId, link.appointmentId, dataAdapterMode);
    const ctx = { organizationId: link.organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: link.id, isSystemGenerated: true };

    await createNotification(
      {
        notificationType: NOTIFICATION_TYPES.CALENDAR_SYNC_FAILED.key,
        entityType: 'appointment',
        entityId: link.appointmentId,
        recipientScope: 'individual',
        recipientIdentityId: staffProfile.identityId,
        caseId: appointment?.caseId ?? undefined,
        actionUrl: `${getAppBaseUrl()}/settings/calendar-integrations`,
        tokens: { entityTitle: appointment?.title ?? 'an appointment' },
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    await recordCalendarSyncFailed(ctx, link.appointmentId, link.calendarConnectionId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to send calendar.sync.failed notification:', error instanceof Error ? error.message : error);
  }
}

export type CalendarSyncSweepResult = { processed: number };

/** Cron-triggered only (`app/api/cron/calendar-sync/route.ts`). Every
    link failure is caught and recorded per-link (`recordSyncFailure`)
    — one bad connection/appointment never aborts the rest of the
    sweep's batch. */
export async function runCalendarSyncSweep(dataAdapterMode: DataAdapterMode, now: string = nowIso()): Promise<CalendarSyncSweepResult> {
  const candidates = await listSweepCandidates(dataAdapterMode);
  const nowMs = new Date(now).getTime();
  let processed = 0;
  for (const link of candidates) {
    if (!isRetryDue(link, nowMs)) continue;
    await processLink(link, dataAdapterMode);
    processed += 1;
  }
  return { processed };
}
