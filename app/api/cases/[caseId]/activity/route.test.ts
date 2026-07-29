import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { record } from '@/services/activityService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function requestFor(caseId: string, organizationId: string | null, extraParams: Record<string, string> = {}) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}), ...extraParams });
  return GET(new Request(`http://localhost/api/cases/${caseId}/activity?${params.toString()}`), { params: Promise.resolve({ caseId }) });
}

async function seedEvent(overrides: Partial<Parameters<typeof record>[0]> = {}) {
  return record(
    {
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-1',
      actorIdentityId: 'identity-1',
      actorMembershipId: null,
      actorRoleKey: 'funeralDirector',
      category: 'cases',
      eventType: 'case.updated',
      resourceType: 'case',
      resourceId: 'case-1',
      previousValue: null,
      newValue: null,
      description: 'Case updated',
      metadata: null,
      severity: 'info',
      correlationId: null,
      isSystemGenerated: false,
      ...overrides,
    },
    'mock',
  );
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  activityEventFixtures.length = 0;
});
afterEach(() => {
  activityEventFixtures.length = 0;
});

describe('GET /api/cases/[caseId]/activity', () => {
  it('returns 400 when organizationId is missing', async () => {
    const response = await requestFor('case-1', null);
    expect(response.status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await requestFor('case-1', DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId the session has no membership in', async () => {
    const response = await requestFor('case-1', SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('lists only this case\'s events, never another case\'s in the same organization', async () => {
    await seedEvent({ caseId: 'case-1' });
    await seedEvent({ caseId: 'case-2' });

    const response = await requestFor('case-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].caseId).toBe('case-1');
  });

  it('never returns another organization\'s events, even for the same caseId', async () => {
    mockSession = { user: mockMultiOrgUser };
    await seedEvent({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'shared-case-id' });
    await seedEvent({ organizationId: SECOND_MOCK_ORGANIZATION_ID, caseId: 'shared-case-id' });

    const response = await requestFor('shared-case-id', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('paginates via cursor — a second page never repeats a row from the first', async () => {
    for (let i = 0; i < 5; i++) {
      await seedEvent({ description: `Event ${i}` });
    }

    const page1 = await requestFor('case-1', DEFAULT_ORGANIZATION_ID, { limit: '2' });
    const page1Body = await page1.json();
    expect(page1Body.events).toHaveLength(2);
    expect(page1Body.nextCursor).toBeTruthy();

    const page2 = await requestFor('case-1', DEFAULT_ORGANIZATION_ID, { limit: '2', cursor: page1Body.nextCursor });
    const page2Body = await page2.json();
    expect(page2Body.events).toHaveLength(2);

    const page1Ids = new Set(page1Body.events.map((e: { id: string }) => e.id));
    const page2Ids = new Set(page2Body.events.map((e: { id: string }) => e.id));
    expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false);
  });
});
