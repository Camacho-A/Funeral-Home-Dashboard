import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { appointmentFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET } = await import('./route');
const { createAppointment } = await import('@/services/schedulingService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-case-appt-${idCounter}`;
}
const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };
const TEST_CASE_ID = 'case-appointments-route-test';

function getRequest(caseId: string, organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${caseId}/appointments?${params.toString()}`), { params: Promise.resolve({ caseId }) });
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  appointmentFixtures.length = 0;
  activityEventFixtures.length = 0;
});
afterEach(() => {
  appointmentFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('GET /api/cases/[caseId]/appointments', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest(TEST_CASE_ID, null)).status).toBe(400);
  });

  it('returns this case\'s appointments only', async () => {
    await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', caseId: TEST_CASE_ID, startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    await createAppointment(
      { appointmentType: 'staff.meeting', title: 'Staff meeting', startAt: '2026-09-01T09:00:00.000Z', endAt: '2026-09-01T09:30:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    const response = await getRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0].caseId).toBe(TEST_CASE_ID);
  });

  it('never crosses tenant boundaries, even for an identical caseId string', async () => {
    await createAppointment(
      { appointmentType: 'viewing', title: 'Org A viewing', caseId: TEST_CASE_ID, startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      SEED_CTX,
      'mock',
    );
    await createAppointment(
      { appointmentType: 'viewing', title: 'Org B viewing', caseId: TEST_CASE_ID, startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      { ...SEED_CTX, organizationId: SECOND_MOCK_ORGANIZATION_ID },
      'mock',
    );
    const response = await getRequest(TEST_CASE_ID, DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0].title).toBe('Org A viewing');
  });
});
