import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markPendingForAppointment, markPendingForCancellation, runCalendarSyncSweep, listLinksForAppointment } from './calendarSyncService';
import { calendarConnectionFixtures, calendarEventLinkFixtures } from './__mocks__/calendarFixtures';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { notificationFixtures } from './__mocks__/notificationFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { encryptCalendarToken } from '../lib/identity/calendarTokenEncryption';
import type { CalendarConnection } from '../types/calendarConnection';
import type { CalendarEventLink } from '../types/calendarEventLink';
import type { Appointment } from '../types/appointment';

beforeEach(() => {
  calendarConnectionFixtures.length = 0;
  calendarEventLinkFixtures.length = 0;
  appointmentFixtures.length = 0;
  notificationFixtures.length = 0;
  activityEventFixtures.length = 0;
});
afterEach(() => {
  calendarConnectionFixtures.length = 0;
  calendarEventLinkFixtures.length = 0;
  appointmentFixtures.length = 0;
  notificationFixtures.length = 0;
  activityEventFixtures.length = 0;
  vi.unstubAllGlobals();
});

function seedConnection(overrides: Partial<CalendarConnection> = {}): CalendarConnection {
  const connection: CalendarConnection = {
    id: `${DEFAULT_ORGANIZATION_ID}-staff-dana-google`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    staffProfileId: 'staff-dana',
    provider: 'google',
    externalAccountEmail: 'dana@gmail.com',
    externalCalendarId: 'primary',
    status: 'connected',
    scopesGranted: 'calendar.events',
    accessTokenCiphertext: encryptCalendarToken('real-access-token'),
    refreshTokenCiphertext: encryptCalendarToken('real-refresh-token'),
    tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    connectedAt: '2026-09-01T00:00:00.000Z',
    disconnectedAt: null,
    lastSyncAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  calendarConnectionFixtures.push(connection);
  return connection;
}

function seedAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const appointment: Appointment = {
    id: 'appt-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: null,
    appointmentType: 'viewing',
    title: 'Viewing',
    notes: 'Family viewing',
    locationId: null,
    status: 'scheduled',
    startAt: '2026-09-10T14:00:00.000Z',
    endAt: '2026-09-10T15:00:00.000Z',
    timezone: 'America/New_York',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: 'staff-dana',
    createdBy: 'staff-dana',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'corr-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  appointmentFixtures.push(appointment);
  return appointment;
}

function seedLink(overrides: Partial<CalendarEventLink> = {}): CalendarEventLink {
  const link: CalendarEventLink = {
    id: 'appt-1-conn-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    appointmentId: 'appt-1',
    calendarConnectionId: `${DEFAULT_ORGANIZATION_ID}-staff-dana-google`,
    provider: 'google',
    externalCalendarId: 'primary',
    externalEventId: null,
    syncStatus: 'pending',
    beaconAppointmentVersion: 0,
    lastSyncedAt: null,
    lastError: null,
    retryCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  calendarEventLinkFixtures.push(link);
  return link;
}

describe('markPendingForAppointment', () => {
  it('is a silent no-op when the appointment has no owner', async () => {
    const appointment = seedAppointment({ ownerStaffProfileId: null });
    await markPendingForAppointment(appointment, 'mock');
    expect(calendarEventLinkFixtures).toHaveLength(0);
  });

  it("is a silent no-op when the owner has no active connection", async () => {
    const appointment = seedAppointment();
    await markPendingForAppointment(appointment, 'mock');
    expect(calendarEventLinkFixtures).toHaveLength(0);
  });

  it('creates a pending link, deterministically keyed, for each active connection', async () => {
    const connection = seedConnection();
    const appointment = seedAppointment();
    await markPendingForAppointment(appointment, 'mock');
    expect(calendarEventLinkFixtures).toHaveLength(1);
    expect(calendarEventLinkFixtures[0]).toMatchObject({
      id: `${appointment.id}-${connection.id}`,
      syncStatus: 'pending',
      externalEventId: null,
    });
  });

  it('re-marks an already-synced link back to pending, resetting retryCount but preserving externalEventId/version history', async () => {
    const connection = seedConnection();
    const appointment = seedAppointment();
    seedLink({ id: `${appointment.id}-${connection.id}`, syncStatus: 'synced', externalEventId: 'ext-1', beaconAppointmentVersion: 1, retryCount: 3, lastSyncedAt: '2026-09-02T00:00:00.000Z' });

    await markPendingForAppointment(appointment, 'mock');

    expect(calendarEventLinkFixtures).toHaveLength(1);
    expect(calendarEventLinkFixtures[0]).toMatchObject({ syncStatus: 'pending', externalEventId: 'ext-1', beaconAppointmentVersion: 1, retryCount: 0, lastSyncedAt: '2026-09-02T00:00:00.000Z' });
  });
});

describe('markPendingForCancellation', () => {
  it('is a no-op when no link exists for the appointment', async () => {
    await markPendingForCancellation(DEFAULT_ORGANIZATION_ID, 'appt-1', 'mock');
    expect(calendarEventLinkFixtures).toHaveLength(0);
  });

  it('flips an existing synced link back to pending', async () => {
    seedLink({ syncStatus: 'synced', externalEventId: 'ext-1', retryCount: 2 });
    await markPendingForCancellation(DEFAULT_ORGANIZATION_ID, 'appt-1', 'mock');
    const links = await listLinksForAppointment(DEFAULT_ORGANIZATION_ID, 'appt-1', 'mock');
    expect(links[0]).toMatchObject({ syncStatus: 'pending', retryCount: 0 });
  });

  it('leaves a disconnected link untouched — never retried', async () => {
    seedLink({ syncStatus: 'disconnected' });
    await markPendingForCancellation(DEFAULT_ORGANIZATION_ID, 'appt-1', 'mock');
    const links = await listLinksForAppointment(DEFAULT_ORGANIZATION_ID, 'appt-1', 'mock');
    expect(links[0].syncStatus).toBe('disconnected');
  });
});

describe('runCalendarSyncSweep', () => {
  it('creates the external event for a fresh pending link, then flips to synced', async () => {
    seedConnection();
    seedAppointment();
    seedLink();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'google-event-1' }) }));

    const result = await runCalendarSyncSweep('mock');
    expect(result.processed).toBe(1);
    expect(calendarEventLinkFixtures[0]).toMatchObject({ syncStatus: 'synced', externalEventId: 'google-event-1', beaconAppointmentVersion: 1 });
  });

  it('calls updateEvent (not createEvent) when the link already has an externalEventId', async () => {
    seedConnection();
    seedAppointment();
    seedLink({ externalEventId: 'existing-event' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await runCalendarSyncSweep('mock');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/events/existing-event'), expect.objectContaining({ method: 'PUT' }));
    expect(calendarEventLinkFixtures[0].syncStatus).toBe('synced');
  });

  it('deletes the external event and removes the link row entirely for a cancelled appointment', async () => {
    seedConnection();
    seedAppointment({ status: 'cancelled', cancelledAt: '2026-09-03T00:00:00.000Z' });
    seedLink({ externalEventId: 'existing-event' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await runCalendarSyncSweep('mock');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/events/existing-event'), expect.objectContaining({ method: 'DELETE' }));
    expect(calendarEventLinkFixtures).toHaveLength(0);
  });

  it('removes the link row without calling deleteEvent when a cancelled appointment was never actually synced', async () => {
    seedConnection();
    seedAppointment({ status: 'cancelled', cancelledAt: '2026-09-03T00:00:00.000Z' });
    seedLink({ externalEventId: null });

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runCalendarSyncSweep('mock');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calendarEventLinkFixtures).toHaveLength(0);
  });

  it('flips the link to disconnected (never retried) when its connection is no longer connected', async () => {
    seedConnection({ status: 'reauth_required' });
    seedAppointment();
    seedLink();

    const result = await runCalendarSyncSweep('mock');
    expect(result.processed).toBe(1);
    expect(calendarEventLinkFixtures[0].syncStatus).toBe('disconnected');

    const secondResult = await runCalendarSyncSweep('mock');
    expect(secondResult.processed).toBe(0); // disconnected is not a sweep candidate
  });

  it('flips to retry_pending with an incremented retryCount on a provider failure', async () => {
    seedConnection();
    seedAppointment();
    seedLink();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'Server error' }));

    await runCalendarSyncSweep('mock');
    expect(calendarEventLinkFixtures[0]).toMatchObject({ syncStatus: 'retry_pending', retryCount: 1 });
    expect(calendarEventLinkFixtures[0].lastError).toBeTruthy();
  });

  it('flips to failed and fires a calendar.sync.failed notification once retryCount exceeds the max', async () => {
    seedConnection();
    seedAppointment();
    seedLink({ retryCount: 5, updatedAt: new Date(Date.now() - 25 * 3600_000).toISOString() });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'Server error' }));

    await runCalendarSyncSweep('mock');
    expect(calendarEventLinkFixtures[0].syncStatus).toBe('failed');
    expect(notificationFixtures.some((n) => n.notificationType === 'system.calendar_sync_failed')).toBe(true);
    expect(activityEventFixtures.some((e) => e.eventType === 'system.calendar.sync_failed')).toBe(true);
  });

  it('skips a retry_pending link still within its backoff window', async () => {
    seedConnection();
    seedAppointment();
    seedLink({ syncStatus: 'retry_pending', retryCount: 1, updatedAt: new Date().toISOString() }); // 5-minute backoff, just updated

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await runCalendarSyncSweep('mock');
    expect(result.processed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a retry_pending link once its backoff window has elapsed', async () => {
    seedConnection();
    seedAppointment();
    seedLink({ syncStatus: 'retry_pending', retryCount: 1, updatedAt: new Date(Date.now() - 10 * 60_000).toISOString() }); // 10 minutes ago, past the 5-minute backoff

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'google-event-2' }) }));

    const result = await runCalendarSyncSweep('mock');
    expect(result.processed).toBe(1);
    expect(calendarEventLinkFixtures[0].syncStatus).toBe('synced');
  });
});
