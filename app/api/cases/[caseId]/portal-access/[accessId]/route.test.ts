import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import type { PortalAccess } from '@/types/portalAccess';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');

const TEST_CASE_ID = 'case-portal-access-patch-route-test';

function makeAccess(overrides: Partial<PortalAccess> = {}): PortalAccess {
  return {
    id: 'access-patch-1',
    portalUserId: 'portal-user-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: TEST_CASE_ID,
    relationshipType: 'primary_next_of_kin',
    status: 'active',
    grantedFromInvitationId: 'invitation-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function patchRequest(accessId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/portal-access/${accessId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID, accessId }),
  });
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  portalAccessFixtures.length = 0;
  activityEventFixtures.length = 0;
});
afterEach(() => {
  portalAccessFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('PATCH /api/cases/[caseId]/portal-access/[accessId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    portalAccessFixtures.push(makeAccess());
    const response = await patchRequest('access-patch-1', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'revoke' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    portalAccessFixtures.push(makeAccess());
    mockSession = null;
    expect((await patchRequest('access-patch-1', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'revoke' })).status).toBe(401);
  });

  it('rejects an invalid action', async () => {
    portalAccessFixtures.push(makeAccess());
    const response = await patchRequest('access-patch-1', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'delete' });
    expect(response.status).toBe(400);
  });

  it('a role without portal.manage (funeralDirector) is refused', async () => {
    portalAccessFixtures.push(makeAccess());
    const fdUser = { id: 'mock-user-fd-access-patch-test', email: 'fd-access-patch@beacon.test', displayName: 'FD Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: fdUser.id, role: 'funeralDirector', isActive: true } as never);
    mockSession = { user: fdUser };

    expect((await patchRequest('access-patch-1', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'revoke' })).status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('returns 404 for an access grant that does not belong to this case', async () => {
    portalAccessFixtures.push(makeAccess({ caseId: 'a-different-case' }));
    const response = await patchRequest('access-patch-1', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'revoke' });
    expect(response.status).toBe(404);
  });

  it('disables a grant without recording portal.access_revoked (that name is reserved for permanent revocation)', async () => {
    portalAccessFixtures.push(makeAccess());
    const response = await patchRequest('access-patch-1', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'disable' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access.status).toBe('disabled');
    expect(activityEventFixtures.some((e) => e.eventType === 'portal.access_revoked')).toBe(false);
  });

  it('revokes a grant and records portal.access_revoked', async () => {
    portalAccessFixtures.push(makeAccess());
    const response = await patchRequest('access-patch-1', { organizationId: DEFAULT_ORGANIZATION_ID, action: 'revoke' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access.status).toBe('revoked');
    expect(activityEventFixtures.some((e) => e.eventType === 'portal.access_revoked')).toBe(true);
  });
});
