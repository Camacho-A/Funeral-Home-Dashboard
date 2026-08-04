import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { notificationPreferenceFixtures } from '@/services/__mocks__/notificationFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET, PATCH } = await import('./route');

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/notifications/preferences?${params.toString()}`));
}

function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }) {
  return PATCH(new Request('http://localhost/api/notifications/preferences', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  notificationPreferenceFixtures.length = 0;
});

afterEach(() => {
  notificationPreferenceFixtures.length = 0;
});

describe('GET /api/notifications/preferences', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest({})).status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID })).status).toBe(403);
  });

  it('returns default-enabled preferences when no row exists yet', async () => {
    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preferences.emailEnabled).toBe(true);
    expect(body.preferences.inAppEnabled).toBe(true);
  });
});

describe('PATCH /api/notifications/preferences', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, emailEnabled: false }, { origin: 'http://evil.test', host: 'localhost', 'content-type': 'application/json' });
    expect(response.status).toBe(403);
  });

  it('updates only the field sent, leaving the other untouched', async () => {
    await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, emailEnabled: false });
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, inAppEnabled: false });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preferences.emailEnabled).toBe(false);
    expect(body.preferences.inAppEnabled).toBe(false);
    expect(notificationPreferenceFixtures).toHaveLength(1);
  });

  it('rejects a non-boolean emailEnabled', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, emailEnabled: 'nope' });
    expect(response.status).toBe(400);
  });
});
