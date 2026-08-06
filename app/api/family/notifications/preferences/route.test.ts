import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { notificationPreferenceFixtures } from '@/services/__mocks__/notificationFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { GET, PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-preferences-route-test-${idCounter}`;
}

function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request('http://localhost/api/family/notifications/preferences', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

let lengths: { users: number; sessions: number; access: number; preferences: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length, access: portalAccessFixtures.length, preferences: notificationPreferenceFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  notificationPreferenceFixtures.length = lengths.preferences;
});

async function seedAuthorizedSession() {
  const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
  const { createPortalSession } = await import('@/services/portal/portalSessionService');
  const { portalUser } = await findOrCreatePortalUser(
    { email: 'family-preferences@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
    'mock',
  );
  const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
  familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
  portalAccessFixtures.push({
    id: 'access-1',
    portalUserId: portalUser.id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    relationshipType: 'primary_next_of_kin',
    status: 'active',
    grantedFromInvitationId: 'invitation-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  return portalUser;
}

describe('GET /api/family/notifications/preferences', () => {
  it('returns 401 with no family session', async () => {
    expect((await GET()).status).toBe(401);
  });

  it('returns default preferences for an authorized portal user with no stored row', async () => {
    await seedAuthorizedSession();
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preferences.emailEnabled).toBe(true);
    expect(body.preferences.inAppEnabled).toBe(true);
  });
});

describe('PATCH /api/family/notifications/preferences', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    expect((await patchRequest({ emailEnabled: false }, { origin: 'http://evil.test', host: 'localhost' })).status).toBe(403);
  });

  it('returns 401 with no family session', async () => {
    expect((await patchRequest({ emailEnabled: false })).status).toBe(401);
  });

  it('updates emailEnabled without touching inAppEnabled', async () => {
    await seedAuthorizedSession();
    const response = await patchRequest({ emailEnabled: false });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preferences.emailEnabled).toBe(false);
    expect(body.preferences.inAppEnabled).toBe(true);
  });
});
