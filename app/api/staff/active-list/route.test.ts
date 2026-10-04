import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession, createSession: vi.fn() }));

const { GET } = await import('./route');

function getRequest(organizationId: string | null) {
  const url = organizationId ? `http://localhost/api/staff/active-list?organizationId=${organizationId}` : 'http://localhost/api/staff/active-list';
  return GET(new Request(url));
}

/**
 * Addendum 2, item #1 (2026-10). Mirrors `/api/staff/active-count`'s own
 * authorization shape exactly (`requireAuthorizedOrganization`, no
 * permission beyond authenticated membership) — the richer "who's
 * actually online, grouped by role" behavior is covered by
 * `services/sessionService.test.ts`'s own
 * `listDistinctActiveStaffForOrganization` describe block; this file only
 * needs to confirm the route's own auth gating and response shape.
 */
describe('GET /api/staff/active-list', () => {
  it('requires organizationId', async () => {
    const response = await getRequest(null);
    expect(response.status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(401);
    mockSession = { user: mockDefaultUser };
  });

  it("returns 403 for an organization the caller isn't a member of", async () => {
    mockSession = { user: mockDefaultUser };
    const response = await getRequest(SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('returns {staff: []} for an authorized organization with no active sessions — never email or id, per the service\'s own contract', async () => {
    mockSession = { user: mockDefaultUser };
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ staff: [] });
  });
});
