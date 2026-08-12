import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { staffFixtures } from '@/services/__mocks__/fixtures';
import { calendarFeedTokenFixtures } from '@/services/__mocks__/calendarFixtures';
import type { StaffProfile } from '@/types/staffProfile';
import type { CalendarFeedToken } from '@/types/calendarFeedToken';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { DELETE } = await import('./route');

function deleteRequest(id: string, organizationId: string, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return DELETE(new Request(`http://localhost/api/calendar-feed-tokens/${id}?organizationId=${organizationId}`, { method: 'DELETE', headers }), {
    params: Promise.resolve({ id }),
  });
}

const CALLER_STAFF_PROFILE: StaffProfile = {
  id: 'staff-oauth-caller',
  organizationId: DEFAULT_ORGANIZATION_ID,
  identityId: mockDefaultUser.id,
  membershipId: null,
  displayName: 'Caller',
  role: 'funeral_director',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function seedToken(overrides: Partial<CalendarFeedToken> = {}): CalendarFeedToken {
  const token: CalendarFeedToken = {
    id: 'token-under-test',
    organizationId: DEFAULT_ORGANIZATION_ID,
    tokenHash: 'hash-value',
    scope: 'staff_own',
    ownerStaffProfileId: CALLER_STAFF_PROFILE.id,
    createdAt: '2026-08-01T00:00:00.000Z',
    revokedAt: null,
    lastAccessedAt: null,
    ...overrides,
  };
  calendarFeedTokenFixtures.push(token);
  return token;
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  staffFixtures.push(CALLER_STAFF_PROFILE);
  calendarFeedTokenFixtures.length = 0;
});
afterEach(() => {
  const index = staffFixtures.findIndex((s) => s.id === CALLER_STAFF_PROFILE.id);
  if (index !== -1) staffFixtures.splice(index, 1);
  calendarFeedTokenFixtures.length = 0;
});

describe('DELETE /api/calendar-feed-tokens/[id]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    seedToken();
    const response = await deleteRequest('token-under-test', DEFAULT_ORGANIZATION_ID, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 404 for a nonexistent token', async () => {
    const response = await deleteRequest('does-not-exist', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('lets the owning staff member revoke their own token', async () => {
    seedToken();
    const response = await deleteRequest('token-under-test', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.token.revokedAt).not.toBeNull();
  });

  it("rejects a non-owner without calendar.manage from revoking someone else's token", async () => {
    seedToken({ ownerStaffProfileId: 'staff-dana' });
    mockSession = { user: mockMultiOrgUser };
    const response = await deleteRequest('token-under-test', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it("lets an administrator (calendar.manage) revoke someone else's token", async () => {
    seedToken({ ownerStaffProfileId: 'staff-dana' });
    const response = await deleteRequest('token-under-test', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
  });
});
