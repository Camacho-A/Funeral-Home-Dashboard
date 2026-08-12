import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { staffFixtures } from '@/services/__mocks__/fixtures';
import { calendarFeedTokenFixtures } from '@/services/__mocks__/calendarFixtures';
import type { StaffProfile } from '@/types/staffProfile';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET, POST } = await import('./route');

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/calendar-feed-tokens?${params.toString()}`));
}

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/calendar-feed-tokens', { method: 'POST', headers, body: JSON.stringify(body) }));
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

describe('GET /api/calendar-feed-tokens', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest({})).status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID })).status).toBe(403);
  });

  it("lists only the caller's own tokens", async () => {
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    calendarFeedTokenFixtures.push({
      id: 'other-token',
      organizationId: DEFAULT_ORGANIZATION_ID,
      tokenHash: 'x',
      scope: 'staff_own',
      ownerStaffProfileId: 'staff-dana',
      createdAt: '2026-08-01T00:00:00.000Z',
      revokedAt: null,
      lastAccessedAt: null,
    });

    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0].ownerStaffProfileId).toBe(CALLER_STAFF_PROFILE.id);
  });
});

describe('POST /api/calendar-feed-tokens', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 400 with no organizationId', async () => {
    expect((await postRequest({})).status).toBe(400);
  });

  it('returns 403 when the caller has no active StaffProfile in this organization', async () => {
    const index = staffFixtures.findIndex((s) => s.id === CALLER_STAFF_PROFILE.id);
    staffFixtures.splice(index, 1);
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('generates a token and returns the raw value exactly once', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.rawToken).toHaveLength(64);
    expect(body.token.ownerStaffProfileId).toBe(CALLER_STAFF_PROFILE.id);
    expect(body.token.tokenHash).not.toBe(body.rawToken);
  });
});
