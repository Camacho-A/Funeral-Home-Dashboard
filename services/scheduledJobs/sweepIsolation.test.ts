import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBillReminderSweep, billReminderNotificationId } from '../accountsPayableNotifications';
import { runNotificationDigestSweep } from '../notificationDigestService';
import { runAppointmentReminderSweep } from '../appointmentReminderService';
import { runCalendarSyncSweep } from '../calendarSyncService';
import { updatePreferences } from '../notificationService';
import { vendorBillFixtures } from '../__mocks__/procurementFixtures';
import {
  notificationFixtures,
  notificationRecipientFixtures,
  notificationDeliveryFixtures,
  notificationDeliveryAttemptFixtures,
  notificationPreferenceFixtures,
} from '../__mocks__/notificationFixtures';
import { appointmentReminderFixtures } from '../__mocks__/schedulingReminderFixtures';
import { appointmentFixtures } from '../__mocks__/schedulingFixtures';
import { calendarConnectionFixtures, calendarEventLinkFixtures } from '../__mocks__/calendarFixtures';
import { activityEventFixtures } from '../__mocks__/activityEventFixtures';
import { MANORS_ADMIN_IDENTITY_ID } from '../__mocks__/identityFixtures';
import { encryptCalendarToken } from '../../lib/identity/calendarTokenEncryption';
import type { VendorBill } from '../../types/vendorBill';
import type { Notification } from '../../types/notification';
import type { NotificationDelivery } from '../../types/notificationDelivery';
import type { AppointmentReminder } from '../../types/appointmentReminder';
import type { Appointment } from '../../types/appointment';
import type { CalendarConnection } from '../../types/calendarConnection';
import type { CalendarEventLink } from '../../types/calendarEventLink';

/**
 * Scheduled-job isolation (2026-10, docs/SCHEDULED_JOBS.md) — mock-mode
 * behaviour of every cron sweep with DEPLOYMENT_ORGANIZATION_IDS set (only
 * this deployment's rows are processed; the other tenant's rows are left
 * byte-for-byte untouched), unrestricted mode unchanged, and idempotency
 * (a second / overlapping run never double-sends). All fixtures are
 * test-local rows pushed into (and cleared from) the shared mock arrays.
 */

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';
const NOW = '2026-09-10T12:00:00.000Z';

const fixtureArrays: unknown[][] = [
  vendorBillFixtures,
  notificationFixtures,
  notificationRecipientFixtures,
  notificationDeliveryFixtures,
  notificationDeliveryAttemptFixtures,
  notificationPreferenceFixtures,
  appointmentReminderFixtures,
  appointmentFixtures,
  calendarConnectionFixtures,
  calendarEventLinkFixtures,
  activityEventFixtures,
];
let originalDeploymentIds: string | undefined;

beforeEach(() => {
  originalDeploymentIds = process.env.DEPLOYMENT_ORGANIZATION_IDS;
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  fixtureArrays.forEach((a) => (a.length = 0));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (originalDeploymentIds === undefined) delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  else process.env.DEPLOYMENT_ORGANIZATION_IDS = originalDeploymentIds;
  fixtureArrays.forEach((a) => (a.length = 0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function restrictToGus() {
  process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
}

// ---------------------------------------------------------------------------
// Bill reminders
// ---------------------------------------------------------------------------

function seedBill(organizationId: string, overrides: Partial<VendorBill> = {}): VendorBill {
  const bill: VendorBill = {
    id: `bill-${organizationId}`,
    organizationId,
    billNumber: `INV-${organizationId}`,
    supplierId: 'supplier-test',
    purchaseOrderId: null,
    billDate: '2026-08-01T00:00:00.000Z',
    dueDate: '2026-09-01T00:00:00.000Z', // overdue at NOW
    status: 'open',
    goodsAmountCents: 10_000,
    additionalChargesCents: 0,
    totalAmountCents: 10_000,
    amountPaidCents: 0,
    netVarianceCents: 0,
    journalEntryId: null,
    notes: null,
    createdByStaffProfileId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
  vendorBillFixtures.push(bill);
  return bill;
}

describe('runBillReminderSweep — deployment scope + dedupe', () => {
  it('with DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr reminds only Gus bills; Manors gets no notification', async () => {
    restrictToGus();
    seedBill(GUS);
    seedBill(MANORS);
    const result = await runBillReminderSweep(NOW, 'mock');
    expect(result.notified).toBe(1);
    expect(notificationFixtures.map((n) => n.organizationId)).toEqual([GUS]);
    expect(notificationFixtures[0].id).toBe(billReminderNotificationId(GUS, `bill-${GUS}`, NOW));
  });

  it('unrestricted (no allowlist, local/mock) keeps the historical every-organization behaviour', async () => {
    seedBill(GUS);
    seedBill(MANORS);
    const result = await runBillReminderSweep(NOW, 'mock');
    expect(result.notified).toBe(2);
    expect(notificationFixtures.map((n) => n.organizationId).sort()).toEqual([GUS, MANORS].sort());
  });

  it('is idempotent per bill per day — a second run the same day sends nothing; the next day reminds again', async () => {
    restrictToGus();
    seedBill(GUS);
    expect((await runBillReminderSweep(NOW, 'mock')).notified).toBe(1);
    expect((await runBillReminderSweep('2026-09-10T20:00:00.000Z', 'mock')).notified).toBe(0);
    expect(notificationFixtures).toHaveLength(1);
    expect((await runBillReminderSweep('2026-09-11T08:00:00.000Z', 'mock')).notified).toBe(1);
    expect(notificationFixtures).toHaveLength(2);
  });

  it('never reminds paid/void bills or bills outside the due-soon window', async () => {
    seedBill(GUS, { id: 'paid', status: 'paid' as VendorBill['status'] });
    seedBill(GUS, { id: 'far', dueDate: '2026-12-01T00:00:00.000Z' });
    expect((await runBillReminderSweep(NOW, 'mock')).notified).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Notification digest
// ---------------------------------------------------------------------------

function seedQueued(organizationId: string): NotificationDelivery {
  const notification: Notification = {
    id: `notif-${organizationId}`,
    organizationId,
    notificationType: 'task.assigned',
    category: 'task',
    title: 'Task assigned',
    body: 'A task was assigned',
    actionUrl: null,
    entityType: null,
    entityId: null,
    recipientScope: 'individual',
    recipientRoleKey: null,
    status: 'active',
    actorIdentityId: null,
    correlationId: `corr-${organizationId}`,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
  notificationFixtures.push(notification);
  const delivery: NotificationDelivery = {
    id: `${notification.id}-${MANORS_ADMIN_IDENTITY_ID}-email`,
    organizationId,
    notificationId: notification.id,
    notificationRecipientId: `${notification.id}-${MANORS_ADMIN_IDENTITY_ID}`,
    identityId: MANORS_ADMIN_IDENTITY_ID,
    channel: 'email',
    status: 'queued_for_digest',
    attemptCount: 0,
    lastAttemptAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
  notificationDeliveryFixtures.push(delivery);
  return delivery;
}

async function dailyDigestFor(organizationId: string) {
  await updatePreferences(organizationId, MANORS_ADMIN_IDENTITY_ID, { digestFrequency: 'daily' }, 'mock');
}

describe('runNotificationDigestSweep — deployment scope + claim-before-send', () => {
  it('flushes only Gus deliveries; the Manors delivery stays queued, untouched, with no attempt', async () => {
    restrictToGus();
    await dailyDigestFor(GUS);
    await dailyDigestFor(MANORS);
    const gus = seedQueued(GUS);
    const manors = seedQueued(MANORS);
    const manorsBefore = { ...manors };

    const result = await runNotificationDigestSweep('mock');
    expect(result).toMatchObject({ groupsConsidered: 1, groupsFlushed: 1, deliveriesFlushed: 1 });
    expect(notificationDeliveryFixtures.find((d) => d.id === gus.id)?.status).toBe('sent');
    expect(notificationDeliveryFixtures.find((d) => d.organizationId === MANORS)).toEqual(manorsBefore);
    expect(notificationDeliveryAttemptFixtures.every((a) => a.organizationId === GUS)).toBe(true);
    expect(notificationPreferenceFixtures.find((p) => p.organizationId === MANORS)?.lastDigestSentAt ?? null).toBeNull();
  });

  it('unrestricted keeps flushing every organization', async () => {
    await dailyDigestFor(GUS);
    await dailyDigestFor(MANORS);
    seedQueued(GUS);
    seedQueued(MANORS);
    const result = await runNotificationDigestSweep('mock');
    expect(result.groupsFlushed).toBe(2);
  });

  it('two overlapping sweeps send each delivery exactly once', async () => {
    restrictToGus();
    await dailyDigestFor(GUS);
    seedQueued(GUS);
    const [a, b] = await Promise.all([runNotificationDigestSweep('mock'), runNotificationDigestSweep('mock')]);
    expect(a.deliveriesFlushed + b.deliveriesFlushed).toBe(1);
    expect(notificationDeliveryAttemptFixtures).toHaveLength(1);
  });

  it('skips a delivery freshly claimed by another sweep, and reclaims one whose claim expired', async () => {
    restrictToGus();
    await dailyDigestFor(GUS);
    const delivery = seedQueued(GUS);
    delivery.lastAttemptAt = new Date(Date.now() - 60_000).toISOString(); // in flight elsewhere
    expect((await runNotificationDigestSweep('mock')).deliveriesFlushed).toBe(0);
    expect(notificationDeliveryAttemptFixtures).toHaveLength(0);

    delivery.lastAttemptAt = new Date(Date.now() - 60 * 60_000).toISOString(); // abandoned
    expect((await runNotificationDigestSweep('mock')).deliveriesFlushed).toBe(1);
    expect(notificationDeliveryFixtures[0].status).toBe('sent');
  });
});

// ---------------------------------------------------------------------------
// Appointment reminders
// ---------------------------------------------------------------------------

function seedAppointment(organizationId: string): Appointment {
  const appointment: Appointment = {
    id: `appt-${organizationId}`,
    organizationId,
    caseId: null,
    appointmentType: 'viewing',
    title: 'Viewing',
    notes: null,
    locationId: null,
    status: 'scheduled',
    startAt: '2026-09-10T14:00:00.000Z',
    endAt: '2026-09-10T15:00:00.000Z',
    timezone: 'America/Chicago',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'staff-test',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: `corr-${organizationId}`,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  appointmentFixtures.push(appointment);
  return appointment;
}

function seedReminder(organizationId: string, overrides: Partial<AppointmentReminder> = {}): AppointmentReminder {
  const reminder: AppointmentReminder = {
    id: `appt-${organizationId}-120-staff_owner-${MANORS_ADMIN_IDENTITY_ID}`,
    organizationId,
    appointmentId: `appt-${organizationId}`,
    leadTimeMinutes: 120,
    recipientType: 'staff_owner',
    recipientIdentityId: MANORS_ADMIN_IDENTITY_ID,
    recipientPortalUserId: null,
    scheduledFor: '2026-09-10T12:00:00.000Z',
    status: 'scheduled',
    notificationId: null,
    sentAt: null,
    cancelledAt: null,
    failureReason: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  appointmentReminderFixtures.push(reminder);
  return reminder;
}

describe('runAppointmentReminderSweep — deployment scope + claim-before-send', () => {
  it('processes only the Gus reminder; the Manors reminder is untouched and produces no notification', async () => {
    restrictToGus();
    seedAppointment(GUS);
    seedAppointment(MANORS);
    seedReminder(GUS);
    const manors = seedReminder(MANORS);
    const manorsBefore = { ...manors };

    const result = await runAppointmentReminderSweep('mock', NOW);
    expect(result.considered).toBe(1);
    expect(result.sent).toBe(1);
    expect(appointmentReminderFixtures.find((r) => r.organizationId === GUS)?.status).toBe('sent');
    expect(notificationFixtures.map((n) => n.organizationId)).toEqual([GUS]);
    expect(appointmentReminderFixtures.find((r) => r.organizationId === MANORS)).toEqual(manorsBefore);
    expect(notificationFixtures.some((n) => n.organizationId === MANORS)).toBe(false);
  });

  it('unrestricted keeps processing every organization', async () => {
    seedAppointment(GUS);
    seedAppointment(MANORS);
    seedReminder(GUS);
    seedReminder(MANORS);
    const result = await runAppointmentReminderSweep('mock', NOW);
    expect(result.considered).toBe(2);
    expect(appointmentReminderFixtures.every((r) => r.status !== 'scheduled')).toBe(true);
  });

  it('two overlapping sweeps create exactly one notification per reminder; a re-run sends nothing', async () => {
    restrictToGus();
    seedAppointment(GUS);
    seedReminder(GUS);
    const [a, b] = await Promise.all([runAppointmentReminderSweep('mock', NOW), runAppointmentReminderSweep('mock', NOW)]);
    expect(a.sent + b.sent).toBe(1);
    expect(notificationFixtures).toHaveLength(1);
    const rerun = await runAppointmentReminderSweep('mock', NOW);
    expect(rerun).toMatchObject({ considered: 0, sent: 0 });
    expect(notificationFixtures).toHaveLength(1);
    expect(appointmentReminderFixtures[0].status).not.toBe('scheduled');
  });

  it('a freshly claimed reminder is skipped; an abandoned claim is marked failed, never re-sent', async () => {
    restrictToGus();
    seedAppointment(GUS);
    const reminder = seedReminder(GUS, { sentAt: '2026-09-10T11:55:00.000Z' }); // claimed 5 minutes before NOW
    let result = await runAppointmentReminderSweep('mock', NOW);
    expect(result).toMatchObject({ sent: 0, failed: 0 });
    expect(appointmentReminderFixtures[0].status).toBe('scheduled');

    reminder.sentAt = '2026-09-10T10:00:00.000Z'; // two hours old — the claiming sweep died
    appointmentReminderFixtures[0] = reminder;
    result = await runAppointmentReminderSweep('mock', NOW);
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(appointmentReminderFixtures[0].status).toBe('failed');
    expect(notificationFixtures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Calendar sync
// ---------------------------------------------------------------------------

function seedCalendar(organizationId: string): CalendarEventLink {
  const connection: CalendarConnection = {
    id: `${organizationId}-conn`,
    organizationId,
    staffProfileId: 'staff-test',
    provider: 'google',
    externalAccountEmail: 'staff@example.test',
    externalCalendarId: 'primary',
    status: 'connected',
    scopesGranted: 'calendar.events',
    accessTokenCiphertext: encryptCalendarToken('access-token'),
    refreshTokenCiphertext: encryptCalendarToken('refresh-token'),
    tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    connectedAt: '2026-09-01T00:00:00.000Z',
    disconnectedAt: null,
    lastSyncAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  calendarConnectionFixtures.push(connection);
  seedAppointment(organizationId);
  const link: CalendarEventLink = {
    id: `appt-${organizationId}-${connection.id}`,
    organizationId,
    appointmentId: `appt-${organizationId}`,
    calendarConnectionId: connection.id,
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
  };
  calendarEventLinkFixtures.push(link);
  return link;
}

describe('runCalendarSyncSweep — deployment scope + claim-before-sync', () => {
  it('syncs only the Gus link; the Manors link is untouched and its provider is never called', async () => {
    restrictToGus();
    seedCalendar(GUS);
    const manors = seedCalendar(MANORS);
    const manorsBefore = { ...manors };
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'google-event-gus' }) });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runCalendarSyncSweep('mock', NOW);
    expect(result.processed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calendarEventLinkFixtures.find((l) => l.organizationId === GUS)).toMatchObject({ syncStatus: 'synced', externalEventId: 'google-event-gus' });
    expect(calendarEventLinkFixtures.find((l) => l.organizationId === MANORS)).toEqual(manorsBefore);
  });

  it('unrestricted keeps syncing every organization', async () => {
    seedCalendar(GUS);
    seedCalendar(MANORS);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'evt' }) }));
    expect((await runCalendarSyncSweep('mock', NOW)).processed).toBe(2);
  });

  it('two overlapping sweeps create the external event exactly once', async () => {
    restrictToGus();
    seedCalendar(GUS);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'google-event-once' }) });
    vi.stubGlobal('fetch', fetchSpy);
    const [a, b] = await Promise.all([runCalendarSyncSweep('mock', NOW), runCalendarSyncSweep('mock', NOW)]);
    expect(a.processed + b.processed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // A later run after the link synced does nothing more.
    expect((await runCalendarSyncSweep('mock', NOW)).processed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Manors deployment direction (DEPLOYMENT_ORGANIZATION_IDS=managed-cremations)
// ---------------------------------------------------------------------------

describe('Manors deployment (DEPLOYMENT_ORGANIZATION_IDS=managed-cremations) never processes Gus rows', () => {
  function restrictToManors() {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = MANORS;
  }

  it('bill reminders: only the Manors bill is reminded; Gus gets no notification', async () => {
    restrictToManors();
    seedBill(GUS);
    seedBill(MANORS);
    const result = await runBillReminderSweep(NOW, 'mock');
    expect(result.notified).toBe(1);
    expect(notificationFixtures.map((n) => n.organizationId)).toEqual([MANORS]);
  });

  it('notification digest: only the Manors delivery is flushed; the Gus delivery is untouched', async () => {
    restrictToManors();
    await dailyDigestFor(GUS);
    await dailyDigestFor(MANORS);
    const gus = seedQueued(GUS);
    const gusBefore = { ...gus };
    seedQueued(MANORS);
    const result = await runNotificationDigestSweep('mock');
    expect(result).toMatchObject({ groupsConsidered: 1, groupsFlushed: 1, deliveriesFlushed: 1 });
    expect(notificationDeliveryFixtures.find((d) => d.organizationId === GUS)).toEqual(gusBefore);
    expect(notificationDeliveryAttemptFixtures.every((a) => a.organizationId === MANORS)).toBe(true);
  });

  it('appointment reminders: only the Manors reminder is processed; the Gus reminder is untouched', async () => {
    restrictToManors();
    seedAppointment(GUS);
    seedAppointment(MANORS);
    const gus = seedReminder(GUS);
    const gusBefore = { ...gus };
    seedReminder(MANORS);
    const result = await runAppointmentReminderSweep('mock', NOW);
    expect(result.considered).toBe(1);
    expect(notificationFixtures.some((n) => n.organizationId === GUS)).toBe(false);
    expect(appointmentReminderFixtures.find((r) => r.organizationId === GUS)).toEqual(gusBefore);
  });

  it('calendar sync: only the Manors link syncs; the Gus link is untouched and its provider never called', async () => {
    restrictToManors();
    const gus = seedCalendar(GUS);
    const gusBefore = { ...gus };
    seedCalendar(MANORS);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'google-event-manors' }) });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runCalendarSyncSweep('mock', NOW);
    expect(result.processed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calendarEventLinkFixtures.find((l) => l.organizationId === GUS)).toEqual(gusBefore);
  });
});
