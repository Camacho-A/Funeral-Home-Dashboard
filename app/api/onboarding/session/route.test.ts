import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures } from '@/services/__mocks__/onboardingFixtures';
import { startOnboarding } from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `session-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    session: onboardingSessionFixtures.length,
  };
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
});

async function seedSession(actorUserId: string) {
  return startOnboarding(
    {
      idempotencyKey: idFactory(),
      legalName: 'Test Org LLC',
      displayName: 'Test Org',
      primaryEmail: 'staff@testorg.test',
      primaryPhone: '(555) 000-0000',
      timezone: 'America/Chicago',
      defaultCurrency: 'usd',
      actorUserId,
      idFactory,
    },
    'mock',
  );
}

function getRequest(sessionId: string | null) {
  const url = sessionId ? `http://localhost/api/onboarding/session?sessionId=${sessionId}` : 'http://localhost/api/onboarding/session';
  return GET(new Request(url));
}

describe('GET /api/onboarding/session', () => {
  it('returns 404 for a nonexistent sessionId', async () => {
    expect((await getRequest('no-such-session')).status).toBe(404);
  });

  it('returns the session, organization, and checklist for the user who started it', async () => {
    const { session } = await seedSession(mockDefaultUser.id);
    const response = await getRequest(session.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.onboardingSession.id).toBe(session.id);
    expect(body.organization).not.toBeNull();
    expect(Array.isArray(body.checklist)).toBe(true);
  });

  it('returns 403 for a user with no relationship to this session or its organization', async () => {
    const { session } = await seedSession(mockDefaultUser.id);
    mockSession = { user: mockMultiOrgUser };
    const response = await getRequest(session.id);
    expect(response.status).toBe(403);
  });

  it('falls back to the caller\'s own most recent non-completed session when no sessionId is given', async () => {
    const { session } = await seedSession(mockDefaultUser.id);
    const response = await getRequest(null);
    const body = await response.json();
    expect(body.onboardingSession?.id).toBe(session.id);
  });

  it('returns an empty (not an error) result for the no-sessionId fallback with no auth session at all', async () => {
    mockSession = null;
    const response = await getRequest(null);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.onboardingSession).toBeNull();
  });
});
