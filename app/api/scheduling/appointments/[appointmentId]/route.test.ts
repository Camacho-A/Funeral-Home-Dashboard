import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { appointmentFixtures, appointmentResourceAssignmentFixtures, resourceFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET, PATCH } = await import('./route');
const { createAppointment } = await import('@/services/schedulingService');
const { create: createResource } = await import('@/services/resourceService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-appt-detail-${idCounter}`;
}

const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function getRequest(appointmentId: string, organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/scheduling/appointments/${appointmentId}?${params.toString()}`), { params: Promise.resolve({ appointmentId }) });
}

function patchRequest(appointmentId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/scheduling/appointments/${appointmentId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ appointmentId }) });
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

describe('GET /api/scheduling/appointments/[appointmentId]', () => {
  it('returns 404 for an unknown appointment', async () => {
    const response = await getRequest('no-such-appointment', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('returns the appointment and its resource assignments', async () => {
    const chapel = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await getRequest(appointment.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointment.id).toBe(appointment.id);
    expect(body.resourceAssignments).toHaveLength(1);
  });

  it('never crosses tenant boundaries — the caller has no membership in the other organization at all', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await getRequest(appointment.id, SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/scheduling/appointments/[appointmentId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await patchRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID, startAt: '2026-09-02T14:00:00.000Z', endAt: '2026-09-02T15:00:00.000Z' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('reschedules when startAt/endAt are given', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await patchRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID, startAt: '2026-09-02T14:00:00.000Z', endAt: '2026-09-02T15:00:00.000Z' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointment.startAt).toBe('2026-09-02T14:00:00.000Z');
  });

  it('adds/removes resources when addResourceIds/removeResourceIds are given', async () => {
    const chapel = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    const vehicle = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    const appointment = await createAppointment(
      { appointmentType: 'funeral.service', title: 'Service', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await patchRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID, addResourceIds: [vehicle.id], removeResourceIds: [chapel.id] });
    expect(response.status).toBe(200);
  });

  it('returns 400 when neither reschedule nor resource-update fields are given', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await patchRequest(appointment.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(400);
  });
});
