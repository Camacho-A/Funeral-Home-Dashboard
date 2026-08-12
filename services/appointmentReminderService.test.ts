import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getReminderPolicy,
  updateReminderPolicy,
  scheduleRemindersForAppointment,
  cancelRemindersForAppointment,
  rescheduleRemindersForAppointment,
  runAppointmentReminderSweep,
} from './appointmentReminderService';
import { appointmentReminderFixtures, schedulingReminderPolicyFixtures } from './__mocks__/schedulingReminderFixtures';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures, notificationDeliveryAttemptFixtures } from './__mocks__/notificationFixtures';
import { portalUserFixtures, portalAccessFixtures } from './__mocks__/portalFixtures';
import { createPendingPortalAccess, activatePortalAccess } from './portal/portalAccessService';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { Appointment } from '../types/appointment';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `reminder-test-${idCounter}`;
}

function baseAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: null,
    appointmentType: 'viewing',
    title: 'Viewing',
    notes: null,
    locationId: null,
    status: 'scheduled',
    startAt: '2026-09-10T14:00:00.000Z',
    endAt: '2026-09-10T15:00:00.000Z',
    timezone: 'America/New_York',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'identity-actor',
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
}

beforeEach(() => {
  idCounter = 0;
  appointmentReminderFixtures.length = 0;
  schedulingReminderPolicyFixtures.length = 0;
  appointmentFixtures.length = 0;
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  portalUserFixtures.length = 0;
  portalAccessFixtures.length = 0;
  activityEventFixtures.length = 0;
});

afterEach(() => {
  appointmentReminderFixtures.length = 0;
  schedulingReminderPolicyFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('getReminderPolicy / updateReminderPolicy', () => {
  it('returns the synthetic default when no row exists', async () => {
    const policy = await getReminderPolicy('org-no-policy', 'mock');
    expect(policy.leadTimesMinutes).toEqual([120, 1440]);
    expect(policy.notifyOwner).toBe(true);
    expect(policy.notifyFamily).toBe(false);
  });

  it('updateReminderPolicy creates a row on first write, patches on subsequent writes', async () => {
    const created = await updateReminderPolicy('org-policy-1', { leadTimesMinutes: [60], notifyFamily: true }, 'mock');
    expect(created.leadTimesMinutes).toEqual([60]);
    expect(created.notifyFamily).toBe(true);
    expect(created.notifyOwner).toBe(true); // untouched field keeps the default

    const updated = await updateReminderPolicy('org-policy-1', { notifyOwner: false }, 'mock');
    expect(updated.notifyOwner).toBe(false);
    expect(updated.leadTimesMinutes).toEqual([60]); // untouched by the second patch

    const refetched = await getReminderPolicy('org-policy-1', 'mock');
    expect(refetched.notifyOwner).toBe(false);
  });
});

describe('scheduleRemindersForAppointment — staff owner', () => {
  it('creates no rows for a draft appointment', async () => {
    const appointment = baseAppointment({ status: 'draft', ownerStaffProfileId: 'staff-dana' });
    await scheduleRemindersForAppointment(appointment, 'mock');
    expect(appointmentReminderFixtures).toHaveLength(0);
  });

  it('creates one scheduled row per configured lead time for a real, active owner', async () => {
    const appointment = baseAppointment({ ownerStaffProfileId: 'staff-dana' });
    await scheduleRemindersForAppointment(appointment, 'mock');

    expect(appointmentReminderFixtures).toHaveLength(2); // default policy: [120, 1440]
    const leadTimes = appointmentReminderFixtures.map((r) => r.leadTimeMinutes).sort((a, b) => a - b);
    expect(leadTimes).toEqual([120, 1440]);
    for (const reminder of appointmentReminderFixtures) {
      expect(reminder.recipientType).toBe('staff_owner');
      expect(reminder.recipientIdentityId).toBe('identity-manors-admin');
      expect(reminder.status).toBe('scheduled');
      expect(reminder.scheduledFor).toBe(new Date(new Date(appointment.startAt).getTime() - reminder.leadTimeMinutes * 60_000).toISOString());
    }
  });

  it('creates zero rows (never invented) when no owner is assigned at all', async () => {
    const appointment = baseAppointment({ ownerStaffProfileId: null });
    await scheduleRemindersForAppointment(appointment, 'mock');
    expect(appointmentReminderFixtures).toHaveLength(0);
  });

  it('creates skipped rows, with a failure reason, when the assigned owner is not an active StaffProfile', async () => {
    // 'staff-chris' exists as a fixture but is not active-with-membership the same way staff-dana is —
    // use an id that resolves to no StaffProfile at all to exercise the ineligible path deterministically.
    const appointment = baseAppointment({ ownerStaffProfileId: 'staff-does-not-exist' });
    await scheduleRemindersForAppointment(appointment, 'mock');
    // No StaffProfile at all resolves via assertStaffProfileIsActiveAndInOrganization throwing
    // StaffAssignmentError ("no staff profile exists") -> treated as 'ineligible', same as an inactive one.
    expect(appointmentReminderFixtures).toHaveLength(2);
    for (const reminder of appointmentReminderFixtures) {
      expect(reminder.status).toBe('skipped');
      expect(reminder.recipientIdentityId).toBeNull();
      expect(reminder.failureReason).toBeTruthy();
    }
  });

  it('is idempotent — scheduling twice for the same appointment does not duplicate rows', async () => {
    const appointment = baseAppointment({ ownerStaffProfileId: 'staff-dana' });
    await scheduleRemindersForAppointment(appointment, 'mock');
    await scheduleRemindersForAppointment(appointment, 'mock');
    expect(appointmentReminderFixtures).toHaveLength(2);
  });

  it('honors a custom policy with a different lead-time set', async () => {
    await updateReminderPolicy(DEFAULT_ORGANIZATION_ID, { leadTimesMinutes: [10080, 4320, 1440, 120] }, 'mock');
    const appointment = baseAppointment({ ownerStaffProfileId: 'staff-dana' });
    await scheduleRemindersForAppointment(appointment, 'mock');
    expect(appointmentReminderFixtures).toHaveLength(4);
  });

  it('creates no rows at all when notifyOwner is false and notifyFamily is false', async () => {
    await updateReminderPolicy(DEFAULT_ORGANIZATION_ID, { notifyOwner: false }, 'mock');
    const appointment = baseAppointment({ ownerStaffProfileId: 'staff-dana' });
    await scheduleRemindersForAppointment(appointment, 'mock');
    expect(appointmentReminderFixtures).toHaveLength(0);
  });
});

describe('scheduleRemindersForAppointment — family (real PortalAccess relationships only)', () => {
  async function seedActivePortalUser(caseId: string, portalUserId: string) {
    portalUserFixtures.push({
      id: portalUserId,
      email: `${portalUserId}@example.com`,
      normalizedEmail: `${portalUserId}@example.com`,
      displayName: 'Family Member',
      passwordHash: 'hash',
      emailVerified: true,
      status: 'active',
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const pending = await createPendingPortalAccess(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId, relationshipType: 'primary_next_of_kin', grantedFromInvitationId: 'inv-1', idFactory },
      'mock',
    );
    await activatePortalAccess(pending.id, portalUserId, 'mock');
  }

  it('creates zero family rows when notifyFamily is false, even with real active grants', async () => {
    await seedActivePortalUser('case-1', 'portal-user-1');
    const appointment = baseAppointment({ caseId: 'case-1', ownerStaffProfileId: null });
    await scheduleRemindersForAppointment(appointment, 'mock');
    expect(appointmentReminderFixtures).toHaveLength(0);
  });

  it('creates one row per active PortalAccess grant per lead time when notifyFamily is true', async () => {
    await updateReminderPolicy(DEFAULT_ORGANIZATION_ID, { notifyFamily: true, notifyOwner: false, leadTimesMinutes: [1440] }, 'mock');
    await seedActivePortalUser('case-1', 'portal-user-1');
    await seedActivePortalUser('case-1', 'portal-user-2');

    const appointment = baseAppointment({ caseId: 'case-1', ownerStaffProfileId: null });
    await scheduleRemindersForAppointment(appointment, 'mock');

    expect(appointmentReminderFixtures).toHaveLength(2);
    const portalUserIds = appointmentReminderFixtures.map((r) => r.recipientPortalUserId).sort();
    expect(portalUserIds).toEqual(['portal-user-1', 'portal-user-2']);
    for (const reminder of appointmentReminderFixtures) {
      expect(reminder.recipientType).toBe('family_portal_user');
      expect(reminder.status).toBe('scheduled');
    }
  });

  it('creates no family rows for an appointment with no caseId, even when notifyFamily is true', async () => {
    await updateReminderPolicy(DEFAULT_ORGANIZATION_ID, { notifyFamily: true, notifyOwner: false }, 'mock');
    const appointment = baseAppointment({ caseId: null });
    await scheduleRemindersForAppointment(appointment, 'mock');
    expect(appointmentReminderFixtures).toHaveLength(0);
  });
});

describe('cancelRemindersForAppointment / rescheduleRemindersForAppointment', () => {
  it('cancels only currently-scheduled rows, never touching already-terminal ones', async () => {
    const appointment = baseAppointment({ ownerStaffProfileId: 'staff-dana' });
    await scheduleRemindersForAppointment(appointment, 'mock');
    const [first, second] = appointmentReminderFixtures;
    // Simulate one reminder having already fired.
    first.status = 'sent';

    await cancelRemindersForAppointment(appointment.organizationId, appointment.id, 'mock');

    expect(appointmentReminderFixtures.find((r) => r.id === first.id)?.status).toBe('sent');
    expect(appointmentReminderFixtures.find((r) => r.id === second.id)?.status).toBe('cancelled');
  });

  it('reschedule reactivates the same rows with the new scheduledFor — never leaves a stale-time reminder active', async () => {
    const appointment = baseAppointment({ ownerStaffProfileId: 'staff-dana' });
    await scheduleRemindersForAppointment(appointment, 'mock');
    const originalIds = appointmentReminderFixtures.map((r) => r.id).sort();
    const originalScheduledFor = appointmentReminderFixtures.map((r) => r.scheduledFor);

    const rescheduled = { ...appointment, startAt: '2026-09-20T14:00:00.000Z', endAt: '2026-09-20T15:00:00.000Z' };
    await rescheduleRemindersForAppointment(rescheduled, 'mock');

    // Same rows reused (deterministic id), never duplicated.
    expect(appointmentReminderFixtures).toHaveLength(2);
    expect(appointmentReminderFixtures.map((r) => r.id).sort()).toEqual(originalIds);
    for (const reminder of appointmentReminderFixtures) {
      expect(reminder.status).toBe('scheduled');
      expect(reminder.cancelledAt).toBeNull();
      expect(originalScheduledFor).not.toContain(reminder.scheduledFor);
    }
  });

  it('a reminder that already fired is never reactivated by a later reschedule', async () => {
    const appointment = baseAppointment({ ownerStaffProfileId: 'staff-dana' });
    await scheduleRemindersForAppointment(appointment, 'mock');
    const sentReminder = appointmentReminderFixtures[0];
    sentReminder.status = 'sent';
    sentReminder.sentAt = '2026-09-05T00:00:00.000Z';

    const rescheduled = { ...appointment, startAt: '2026-09-20T14:00:00.000Z', endAt: '2026-09-20T15:00:00.000Z' };
    await rescheduleRemindersForAppointment(rescheduled, 'mock');

    const stillSent = appointmentReminderFixtures.find((r) => r.id === sentReminder.id);
    expect(stillSent?.status).toBe('sent');
    expect(stillSent?.scheduledFor).toBe(sentReminder.scheduledFor); // untouched
  });
});

describe('runAppointmentReminderSweep', () => {
  it('sends a due reminder via notificationService, marking it sent with a notificationId', async () => {
    const appointment = baseAppointment({ id: 'appt-due', ownerStaffProfileId: 'staff-dana', startAt: '2026-09-10T14:00:00.000Z' });
    appointmentFixtures.push(appointment);
    await updateReminderPolicy(DEFAULT_ORGANIZATION_ID, { leadTimesMinutes: [120] }, 'mock');
    await scheduleRemindersForAppointment(appointment, 'mock');

    const scheduledFor = appointmentReminderFixtures[0].scheduledFor;
    const result = await runAppointmentReminderSweep('mock', scheduledFor);

    expect(result.considered).toBe(1);
    expect(result.sent).toBe(1);
    expect(appointmentReminderFixtures[0].status).toBe('sent');
    expect(appointmentReminderFixtures[0].notificationId).toBeTruthy();
    expect(notificationFixtures).toHaveLength(1);
    expect(notificationFixtures[0].notificationType).toBe('scheduling.appointment_reminder');
    expect(activityEventFixtures.some((e) => e.eventType === 'scheduling.appointment.reminder_sent' && e.resourceId === appointment.id)).toBe(true);
  });

  it('never fires a reminder whose scheduledFor is still in the future', async () => {
    const appointment = baseAppointment({ id: 'appt-future', ownerStaffProfileId: 'staff-dana', startAt: '2026-09-10T14:00:00.000Z' });
    appointmentFixtures.push(appointment);
    await updateReminderPolicy(DEFAULT_ORGANIZATION_ID, { leadTimesMinutes: [120] }, 'mock');
    await scheduleRemindersForAppointment(appointment, 'mock');

    const result = await runAppointmentReminderSweep('mock', '2026-09-01T00:00:00.000Z');
    expect(result.considered).toBe(0);
    expect(appointmentReminderFixtures[0].status).toBe('scheduled');
  });

  it('skips a due reminder whose appointment was cancelled after scheduling (defense in depth)', async () => {
    const appointment = baseAppointment({ id: 'appt-cancelled', ownerStaffProfileId: 'staff-dana', startAt: '2026-09-10T14:00:00.000Z' });
    appointmentFixtures.push(appointment);
    await updateReminderPolicy(DEFAULT_ORGANIZATION_ID, { leadTimesMinutes: [120] }, 'mock');
    await scheduleRemindersForAppointment(appointment, 'mock');
    const scheduledFor = appointmentReminderFixtures[0].scheduledFor;

    // Simulate the appointment having been cancelled without going through
    // cancelAppointment (defense-in-depth path, not the normal flow).
    appointmentFixtures[0].status = 'cancelled';

    const result = await runAppointmentReminderSweep('mock', scheduledFor);
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    expect(appointmentReminderFixtures[0].status).toBe('skipped');
  });

  it('bounds the sweep to due rows only, never scanning by appointment', async () => {
    const dueAppointment = baseAppointment({ id: 'appt-due-2', ownerStaffProfileId: 'staff-dana', startAt: '2026-09-05T00:00:00.000Z' });
    const futureAppointment = baseAppointment({ id: 'appt-not-due', ownerStaffProfileId: 'staff-dana', startAt: '2027-01-01T00:00:00.000Z' });
    appointmentFixtures.push(dueAppointment, futureAppointment);
    await updateReminderPolicy(DEFAULT_ORGANIZATION_ID, { leadTimesMinutes: [120] }, 'mock');
    await scheduleRemindersForAppointment(dueAppointment, 'mock');
    await scheduleRemindersForAppointment(futureAppointment, 'mock');

    const result = await runAppointmentReminderSweep('mock', '2026-09-04T23:00:00.000Z');
    expect(result.considered).toBe(1);
  });
});
