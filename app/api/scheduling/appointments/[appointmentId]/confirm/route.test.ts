import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { appointmentFixtures, appointmentResourceAssignmentFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST } = await import('./route');
const { createAppointment, cancelAppointment } = await import('@/services/schedulingService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-confirm-${idCounter}`;
}
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function postRequest(appointmentId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/scheduling/appointments/${appointmentId}/confirm`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ appointmentId }) });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  activityEventFixtures.length = 0;
});
afterEach(() => {
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('POST /api/scheduling/appointments/[appointmentId]/confirm', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('confirms a scheduled appointment', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointment.status).toBe('confirmed');
  });

  it('returns 422 for an already-terminal appointment', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    await cancelAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, null, SEED_CTX, 'mock');
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(422);
  });

  it('returns 404 for an unknown appointment', async () => {
    const response = await postRequest('no-such-appointment', { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(404);
  });
});
