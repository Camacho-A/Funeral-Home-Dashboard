import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { staffFixtures } from '@/services/__mocks__/fixtures';
import type { StaffProfile } from '@/types/staffProfile';

const cookieStore = new Map<string, { value: string }>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => {
      cookieStore.set(name, { value });
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  })),
}));

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST } = await import('./route');
const { OAUTH_STATE_COOKIE_NAME } = await import('@/lib/auth/calendarOAuthState');

function startRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/calendar-connections/google/start', { method: 'POST', headers, body: JSON.stringify(body) }));
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
  cookieStore.clear();
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://beacon.test/api/calendar-connections/google/callback';
});
afterEach(() => {
  const index = staffFixtures.findIndex((s) => s.id === CALLER_STAFF_PROFILE.id);
  if (index !== -1) staffFixtures.splice(index, 1);
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
});

describe('POST /api/calendar-connections/google/start', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await startRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 400 with no organizationId', async () => {
    expect((await startRequest({})).status).toBe(400);
  });

  it('returns 403 when the caller has no active StaffProfile in this organization', async () => {
    const index = staffFixtures.findIndex((s) => s.id === CALLER_STAFF_PROFILE.id);
    staffFixtures.splice(index, 1);
    const response = await startRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it("builds a real Google authorize URL and sets the signed state cookie", async () => {
    const response = await startRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.authorizeUrl).toContain('accounts.google.com');
    expect(cookieStore.has(OAUTH_STATE_COOKIE_NAME)).toBe(true);
  });
});
