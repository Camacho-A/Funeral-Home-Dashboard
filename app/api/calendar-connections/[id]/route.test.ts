import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { staffFixtures } from '@/services/__mocks__/fixtures';
import { calendarConnectionFixtures } from '@/services/__mocks__/calendarFixtures';
import type { CalendarConnection } from '@/types/calendarConnection';
import type { StaffProfile } from '@/types/staffProfile';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { DELETE } = await import('./route');

function deleteRequest(id: string, organizationId: string, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return DELETE(new Request(`http://localhost/api/calendar-connections/${id}?organizationId=${organizationId}`, { method: 'DELETE', headers }), {
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

function seedConnection(overrides: Partial<CalendarConnection>): CalendarConnection {
  const connection: CalendarConnection = {
    id: 'conn-under-test',
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

describe('DELETE /api/calendar-connections/[id]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    seedConnection({});
    const response = await deleteRequest('conn-under-test', DEFAULT_ORGANIZATION_ID, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 400 with no organizationId', async () => {
    const response = await DELETE(new Request('http://localhost/api/calendar-connections/conn-under-test', { method: 'DELETE', headers: { origin: 'http://localhost', host: 'localhost' } }), {
      params: Promise.resolve({ id: 'conn-under-test' }),
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent connection', async () => {
    const response = await deleteRequest('conn-does-not-exist', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('lets the owning staff member disconnect their own connection', async () => {
    seedConnection({});
    const response = await deleteRequest('conn-under-test', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connection.status).toBe('disconnected');
  });

  it("rejects a non-owner without calendar.manage from disconnecting someone else's connection", async () => {
    seedConnection({ staffProfileId: 'staff-dana' });
    mockSession = { user: mockMultiOrgUser };
    const response = await deleteRequest('conn-under-test', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it("lets an administrator (calendar.manage) disconnect someone else's connection", async () => {
    seedConnection({ staffProfileId: 'staff-dana' });
    const response = await deleteRequest('conn-under-test', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
  });
});
