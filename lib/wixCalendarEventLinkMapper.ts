import type { CalendarEventLink, CalendarSyncStatus } from '../types/calendarEventLink';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Standard mapper pair for the `calendarEventLinks`
 * collection — see `types/calendarEventLink.ts`'s own header comment
 * for why a row's existence always means an external event exists (or
 * is pending creation), and why the row is deleted outright rather
 * than left in a terminal "deleted" syncStatus once a cancelled
 * appointment's external event is confirmed removed.
 */
export type WixCalendarEventLinkItem = {
  beaconCalendarEventLinkId?: unknown;
  organizationId?: unknown;
  appointmentId?: unknown;
  calendarConnectionId?: unknown;
  provider?: unknown;
  externalCalendarId?: unknown;
  externalEventId?: unknown;
  syncStatus?: unknown;
  beaconAppointmentVersion?: unknown;
  lastSyncedAt?: unknown;
  lastError?: unknown;
  retryCount?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_PROVIDERS: readonly string[] = ['google', 'microsoft'];
const VALID_SYNC_STATUSES: readonly string[] = ['pending', 'synced', 'retry_pending', 'failed', 'disconnected'];

function isProvider(value: unknown): value is CalendarEventLink['provider'] {
  return typeof value === 'string' && VALID_PROVIDERS.includes(value);
}

function isSyncStatus(value: unknown): value is CalendarSyncStatus {
  return typeof value === 'string' && VALID_SYNC_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixCalendarEventLinkItem(item: WixCalendarEventLinkItem | undefined): CalendarEventLink | null {
  if (
    !item ||
    typeof item.beaconCalendarEventLinkId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.appointmentId !== 'string' ||
    typeof item.calendarConnectionId !== 'string' ||
    !isProvider(item.provider) ||
    typeof item.externalCalendarId !== 'string' ||
    !isStringOrNull(item.externalEventId) ||
    !isSyncStatus(item.syncStatus) ||
    typeof item.beaconAppointmentVersion !== 'number' ||
    !isStringOrNull(item.lastSyncedAt) ||
    !isStringOrNull(item.lastError) ||
    typeof item.retryCount !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconCalendarEventLinkId,
    organizationId: item.organizationId,
    appointmentId: item.appointmentId,
    calendarConnectionId: item.calendarConnectionId,
    provider: item.provider,
    externalCalendarId: item.externalCalendarId,
    externalEventId: item.externalEventId,
    syncStatus: item.syncStatus,
    beaconAppointmentVersion: item.beaconAppointmentVersion,
    lastSyncedAt: item.lastSyncedAt,
    lastError: item.lastError,
    retryCount: item.retryCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixCalendarEventLinkData(link: CalendarEventLink): WixCalendarEventLinkItem {
  return {
    beaconCalendarEventLinkId: link.id,
    organizationId: link.organizationId,
    appointmentId: link.appointmentId,
    calendarConnectionId: link.calendarConnectionId,
    provider: link.provider,
    externalCalendarId: link.externalCalendarId,
    externalEventId: link.externalEventId,
    syncStatus: link.syncStatus,
    beaconAppointmentVersion: link.beaconAppointmentVersion,
    lastSyncedAt: link.lastSyncedAt,
    lastError: link.lastError,
    retryCount: link.retryCount,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

export function applyCalendarEventLinkUpdateToWixData(
  existing: WixCalendarEventLinkItem,
  patch: Partial<Pick<CalendarEventLink, 'externalEventId' | 'syncStatus' | 'beaconAppointmentVersion' | 'lastSyncedAt' | 'lastError' | 'retryCount' | 'updatedAt'>>,
): WixCalendarEventLinkItem {
  const next = { ...existing };
  if (patch.externalEventId !== undefined) next.externalEventId = patch.externalEventId;
  if (patch.syncStatus !== undefined) next.syncStatus = patch.syncStatus;
  if (patch.beaconAppointmentVersion !== undefined) next.beaconAppointmentVersion = patch.beaconAppointmentVersion;
  if (patch.lastSyncedAt !== undefined) next.lastSyncedAt = patch.lastSyncedAt;
  if (patch.lastError !== undefined) next.lastError = patch.lastError;
  if (patch.retryCount !== undefined) next.retryCount = patch.retryCount;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
