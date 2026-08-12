import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { schedulingReminderPolicyFixtures } from '@/services/__mocks__/schedulingReminderFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET, PATCH } = await import('./route');

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/scheduling/reminder-policy?${params.toString()}`));
}

function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request('http://localhost/api/scheduling/reminder-policy', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  schedulingReminderPolicyFixtures.length = 0;
});
afterEach(() => {
  schedulingReminderPolicyFixtures.length = 0;
});

describe('GET /api/scheduling/reminder-policy', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest({})).status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID })).status).toBe(403);
  });

  it('returns the synthetic default when no row exists yet', async () => {
    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.policy).toMatchObject({ leadTimesMinutes: [120, 1440], notifyOwner: true, notifyFamily: false });
  });
});

describe('PATCH /api/scheduling/reminder-policy', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, notifyOwner: false }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 400 with no organizationId', async () => {
    expect((await patchRequest({ notifyOwner: false })).status).toBe(400);
  });

  it('returns 400 for a malformed leadTimesMinutes', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, leadTimesMinutes: ['not-a-number'] });
    expect(response.status).toBe(400);
  });

  it('rejects a role without calendar.manage authority', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, notifyOwner: false });
    expect(response.status).toBe(403);
  });

  it('updates the policy, sorting leadTimesMinutes ascending', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, leadTimesMinutes: [1440, 120, 4320], notifyFamily: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.policy.leadTimesMinutes).toEqual([120, 1440, 4320]);
    expect(body.policy.notifyFamily).toBe(true);
  });
});
