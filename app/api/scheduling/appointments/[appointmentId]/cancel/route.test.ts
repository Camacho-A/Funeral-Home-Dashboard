import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { appointmentFixtures, appointmentResourceAssignmentFixtures, resourceFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST } = await import('./route');
const { createAppointment } = await import('@/services/schedulingService');
const { create: createResource } = await import('@/services/resourceService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-cancel-${idCounter}`;
}
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function postRequest(appointmentId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/scheduling/appointments/${appointmentId}/cancel`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ appointmentId }) });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  resourceFixtures.length = 0;
  activityEventFixtures.length = 0;
});
afterEach(() => {
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  resourceFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('POST /api/scheduling/appointments/[appointmentId]/cancel', () => {
  it('cancels with an optional reason and releases every live resource assignment', async () => {
    const chapel = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID, reason: 'Family rescheduled' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointment.status).toBe('cancelled');
    expect(appointmentResourceAssignmentFixtures[0].releasedAt).not.toBeNull();
  });

  it('returns 422 when replaying an already-cancelled appointment', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(422);
  });

  it("requires schedule.cancel-tier authority — a role with only schedule.create/.edit is denied", async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });
});
