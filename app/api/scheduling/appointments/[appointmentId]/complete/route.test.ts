import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { appointmentFixtures, appointmentResourceAssignmentFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST } = await import('./route');
const { createAppointment } = await import('@/services/schedulingService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-complete-${idCounter}`;
}
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function postRequest(appointmentId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/scheduling/appointments/${appointmentId}/complete`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ appointmentId }) });
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

describe('POST /api/scheduling/appointments/[appointmentId]/complete', () => {
  it('rejects an invalid outcome', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID, outcome: 'bogus' });
    expect(response.status).toBe(400);
  });

  it('marks completed', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID, outcome: 'completed' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointment.status).toBe('completed');
  });

  it('marks no_show as a distinct terminal outcome', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID, outcome: 'no_show' });
    const body = await response.json();
    expect(body.appointment.status).toBe('no_show');
  });
});
