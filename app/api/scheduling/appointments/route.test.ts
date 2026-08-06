import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { appointmentFixtures, appointmentResourceAssignmentFixtures, resourceFixtures, recurrenceDefinitionFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET, POST } = await import('./route');
const { create: createResource } = await import('@/services/resourceService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-appt-${idCounter}`;
}

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/scheduling/appointments?${params.toString()}`));
}

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }) {
  return POST(new Request('http://localhost/api/scheduling/appointments', { method: 'POST', headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  resourceFixtures.length = 0;
  recurrenceDefinitionFixtures.length = 0;
  activityEventFixtures.length = 0;
});

afterEach(() => {
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  resourceFixtures.length = 0;
  recurrenceDefinitionFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('GET /api/scheduling/appointments', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest({})).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID })).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID })).status).toBe(403);
  });

  it('lists appointments scoped to the organization, filtered by date range', async () => {
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York' });
    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID, from: '2026-08-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointments).toHaveLength(1);
  });
});

describe('POST /api/scheduling/appointments', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York' },
      { origin: 'http://evil.test', host: 'localhost', 'content-type': 'application/json' },
    );
    expect(response.status).toBe(403);
  });

  it('rejects an unrecognized appointmentType', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, appointmentType: 'not.a.real.type', title: 'x', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York' });
    expect(response.status).toBe(400);
  });

  it('creates a draft appointment with no resources', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.appointment.status).toBe('draft');
  });

  it('creates a scheduled appointment with resources', async () => {
    const chapel = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      appointmentType: 'viewing',
      title: 'Viewing',
      startAt: '2026-09-01T14:00:00.000Z',
      endAt: '2026-09-01T15:00:00.000Z',
      timezone: 'America/New_York',
      resourceIds: [chapel.id],
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.appointment.status).toBe('scheduled');
  });

  it('returns 409 with conflict details when a hard conflict exists and no override is given', async () => {
    const chapel = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, appointmentType: 'viewing', title: 'First', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id] });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, appointmentType: 'viewing', title: 'Second', startAt: '2026-09-01T14:30:00.000Z', endAt: '2026-09-01T15:30:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id] });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.conflicts).toBeDefined();
  });

  describe('Phase 30 (Identity Model Hardening & Staff Assignment Unification): ownerStaffProfileId', () => {
    it('accepts a valid ownerStaffProfileId, in the DEFAULT_ORGANIZATION_ID staffFixtures set', async () => {
      const response = await postRequest({
        organizationId: DEFAULT_ORGANIZATION_ID,
        appointmentType: 'viewing',
        title: 'Viewing',
        startAt: '2026-09-01T14:00:00.000Z',
        endAt: '2026-09-01T15:00:00.000Z',
        timezone: 'America/New_York',
        ownerStaffProfileId: 'staff-dana',
      });
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.appointment.ownerStaffProfileId).toBe('staff-dana');
    });

    it('rejects a nonexistent ownerStaffProfileId with 422, before any write', async () => {
      const response = await postRequest({
        organizationId: DEFAULT_ORGANIZATION_ID,
        appointmentType: 'viewing',
        title: 'Viewing',
        startAt: '2026-09-01T14:00:00.000Z',
        endAt: '2026-09-01T15:00:00.000Z',
        timezone: 'America/New_York',
        ownerStaffProfileId: 'staff-does-not-exist',
      });
      expect(response.status).toBe(422);
      expect(appointmentFixtures).toHaveLength(0);
    });

    it('returns 400 when ownerStaffProfileId is present but not a string', async () => {
      const response = await postRequest({
        organizationId: DEFAULT_ORGANIZATION_ID,
        appointmentType: 'viewing',
        title: 'Viewing',
        startAt: '2026-09-01T14:00:00.000Z',
        endAt: '2026-09-01T15:00:00.000Z',
        timezone: 'America/New_York',
        ownerStaffProfileId: 12345,
      });
      expect(response.status).toBe(400);
    });
  });

  it('requires resource.manage-tier authority to submit an override, even when the caller can create appointments', async () => {
    mockSession = { user: mockMultiOrgUser };
    const chapel = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    mockSession = { user: mockDefaultUser };
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, appointmentType: 'viewing', title: 'First', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id] });

    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      appointmentType: 'viewing',
      title: 'Second',
      startAt: '2026-09-01T14:30:00.000Z',
      endAt: '2026-09-01T15:30:00.000Z',
      timezone: 'America/New_York',
      resourceIds: [chapel.id],
      override: { reason: 'Family requested this exact time' },
    });
    expect(response.status).toBe(403);
  });
});
