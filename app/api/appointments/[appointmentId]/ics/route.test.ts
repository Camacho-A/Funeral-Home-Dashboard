import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { appointmentFixtures, appointmentResourceAssignmentFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { notificationFixtures } from '@/services/__mocks__/notificationFixtures';
import { appointmentReminderFixtures } from '@/services/__mocks__/schedulingReminderFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET } = await import('./route');
const { createAppointment } = await import('@/services/schedulingService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-ics-${idCounter}`;
}

const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function getRequest(appointmentId: string, organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/appointments/${appointmentId}/ics?${params.toString()}`), { params: Promise.resolve({ appointmentId }) });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  activityEventFixtures.length = 0;
  notificationFixtures.length = 0;
  appointmentReminderFixtures.length = 0;
});
afterEach(() => {
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  activityEventFixtures.length = 0;
  notificationFixtures.length = 0;
  appointmentReminderFixtures.length = 0;
});

describe('GET /api/appointments/[appointmentId]/ics', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest('does-not-matter', null)).status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest('does-not-matter', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns 404 for a nonexistent appointment', async () => {
    expect((await getRequest('does-not-exist', DEFAULT_ORGANIZATION_ID)).status).toBe(404);
  });

  it('downloads a valid ICS file including notes as DESCRIPTION', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', notes: 'Internal staff note', startAt: '2026-09-10T14:00:00.000Z', endAt: '2026-09-10T15:00:00.000Z', timezone: 'America/New_York', saveAsDraft: false, idFactory },
      SEED_CTX,
      'mock',
    );

    const response = await getRequest(appointment.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/calendar');
    expect(response.headers.get('content-disposition')).toContain(`appointment-${appointment.id}.ics`);

    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain(`UID:beacon-appointment-${appointment.id}@beacon.app`);
    expect(body).toContain('SUMMARY:Viewing');
    expect(body).toContain('DESCRIPTION:Internal staff note');
    expect(body).toContain('STATUS:CONFIRMED');
  });

  it('emits STATUS:CANCELLED for a cancelled appointment', async () => {
    const { cancelAppointment } = await import('@/services/schedulingService');
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-10T14:00:00.000Z', endAt: '2026-09-10T15:00:00.000Z', timezone: 'America/New_York', saveAsDraft: false, idFactory },
      SEED_CTX,
      'mock',
    );
    await cancelAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, 'Family request', SEED_CTX, 'mock');

    const response = await getRequest(appointment.id, DEFAULT_ORGANIZATION_ID);
    const body = await response.text();
    expect(body).toContain('STATUS:CANCELLED');
  });
});
