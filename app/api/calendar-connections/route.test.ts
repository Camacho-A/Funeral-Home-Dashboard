import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { staffFixtures } from '@/services/__mocks__/fixtures';
import { calendarConnectionFixtures } from '@/services/__mocks__/calendarFixtures';
import type { CalendarConnection } from '@/types/calendarConnection';
import type { StaffProfile } from '@/types/staffProfile';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET } = await import('./route');

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/calendar-connections?${params.toString()}`));
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

function seedConnection(overrides: Partial<CalendarConnection>): CalendarConnection {
  const connection: CalendarConnection = {
    id: `conn-${Math.random()}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    staffProfileId: CALLER_STAFF_PROFILE.id,
    provider: 'google',
    externalAccountEmail: 'caller@gmail.com',
    externalCalendarId: 'primary',
    status: 'connected',
    scopesGranted: 'calendar.events',
    accessTokenCiphertext: 'ct-access',
    refreshTokenCiphertext: 'ct-refresh',
    tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    connectedAt: '2026-08-01T00:00:00.000Z',
    disconnectedAt: null,
    lastSyncAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
  calendarConnectionFixtures.push(connection);
  return connection;
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  staffFixtures.push(CALLER_STAFF_PROFILE);
  calendarConnectionFixtures.length = 0;
});
afterEach(() => {
  const index = staffFixtures.findIndex((s) => s.id === CALLER_STAFF_PROFILE.id);
  if (index !== -1) staffFixtures.splice(index, 1);
  calendarConnectionFixtures.length = 0;
});

describe('GET /api/calendar-connections', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest({})).status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID })).status).toBe(403);
  });

  it("returns only the caller's own connections by default", async () => {
    seedConnection({ id: 'conn-mine', staffProfileId: CALLER_STAFF_PROFILE.id });
    seedConnection({ id: 'conn-other', staffProfileId: 'staff-dana' });

    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.connections.map((c: CalendarConnection) => c.id)).toEqual(['conn-mine']);
  });

  it('returns an empty list when the caller has no StaffProfile in this organization', async () => {
    const index = staffFixtures.findIndex((s) => s.id === CALLER_STAFF_PROFILE.id);
    staffFixtures.splice(index, 1);
    seedConnection({ id: 'conn-other', staffProfileId: 'staff-dana' });

    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.connections).toEqual([]);
  });

  it('rejects ?scope=organization without calendar.manage', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID, scope: 'organization' });
    expect(response.status).toBe(403);
  });

  it('returns every connection in the organization for ?scope=organization with calendar.manage', async () => {
    seedConnection({ id: 'conn-mine', staffProfileId: CALLER_STAFF_PROFILE.id });
    seedConnection({ id: 'conn-other', staffProfileId: 'staff-dana' });

    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID, scope: 'organization' });
    const body = await response.json();
    expect(body.connections.map((c: CalendarConnection) => c.id).sort()).toEqual(['conn-mine', 'conn-other']);
  });
});
