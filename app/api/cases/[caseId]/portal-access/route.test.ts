import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { portalAccessFixtures } from '@/services/__mocks__/portalFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET } = await import('./route');

const TEST_CASE_ID = 'case-portal-access-list-route-test';

function listRequest(organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/portal-access?${params.toString()}`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  portalAccessFixtures.length = 0;
});
afterEach(() => {
  portalAccessFixtures.length = 0;
});

describe('GET /api/cases/[caseId]/portal-access', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await listRequest(null)).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await listRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('a role without portal.manage (funeralDirector) is refused', async () => {
    const fdUser = { id: 'mock-user-fd-access-list-test', email: 'fd-access-list@beacon.test', displayName: 'FD Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: fdUser.id, role: 'funeralDirector', isActive: true } as never);
    mockSession = { user: fdUser };

    expect((await listRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('lists every grant for the case, regardless of status', async () => {
    portalAccessFixtures.push(
      { id: 'access-1', portalUserId: 'portal-user-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: TEST_CASE_ID, relationshipType: 'primary_next_of_kin', status: 'active', grantedFromInvitationId: 'invitation-1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'access-2', portalUserId: null, organizationId: DEFAULT_ORGANIZATION_ID, caseId: TEST_CASE_ID, relationshipType: 'secondary_family_member', status: 'pending', grantedFromInvitationId: 'invitation-2', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'access-other-case', portalUserId: 'portal-user-3', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'other-case', relationshipType: 'primary_next_of_kin', status: 'active', grantedFromInvitationId: 'invitation-3', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
    );

    const response = await listRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access.map((a: { id: string }) => a.id).sort()).toEqual(['access-1', 'access-2']);
  });
});
