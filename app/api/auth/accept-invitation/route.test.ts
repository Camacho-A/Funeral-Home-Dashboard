import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  identityFixtures,
  membershipFixtures,
  identitySessionFixtures,
  emailVerificationTokenFixtures,
  loginActivityEventFixtures,
  MANORS_ADMIN_IDENTITY_ID,
} from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `accept-invitation-route-test-${idCounter}`;
}

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: (name: string) => (name === 'user-agent' ? 'vitest-agent' : null) })),
}));

const createSessionMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  createSession: createSessionMock,
}));

const { POST } = await import('./route');

function postRequest(body: unknown) {
  return POST(new Request('http://localhost/api/auth/accept-invitation', { method: 'POST', body: JSON.stringify(body) }));
}

let lengths: { identity: number; membership: number; sessions: number; tokens: number; events: number };
beforeEach(() => {
  idCounter = 0;
  createSessionMock.mockClear();
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    tokens: emailVerificationTokenFixtures.length,
    events: loginActivityEventFixtures.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  emailVerificationTokenFixtures.length = lengths.tokens;
  loginActivityEventFixtures.length = lengths.events;
});

describe('POST /api/auth/accept-invitation', () => {
  it('returns 400 for a missing/short password', async () => {
    expect((await postRequest({ token: 'x', membershipId: 'x', password: 'short' })).status).toBe(400);
  });

  it('returns 400 for an invalid/forged token', async () => {
    const response = await postRequest({ token: 'forged', membershipId: 'whatever', password: 'BrandNewPass1!' });
    expect(response.status).toBe(400);
  });

  it('accepts a genuine invitation, activates the membership, sets a password, and signs the invitee straight in', async () => {
    const { inviteToOrganization } = await import('@/services/invitationService');
    const invited = await inviteToOrganization(
      { email: 'accept.route@example.com', displayName: 'Accept Route', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );

    const response = await postRequest({ token: invited.verificationToken, membershipId: invited.membership.id, password: 'BrandNewPass1!' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.status).toBe('active');

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const [user, sessionId] = createSessionMock.mock.calls[0];
    expect(user).toMatchObject({ id: invited.identity.id, source: 'identity' });
    expect(typeof sessionId).toBe('string');

    const { verifyPassword } = await import('@/services/passwordService');
    expect(await verifyPassword(invited.identity.id, 'BrandNewPass1!', 'mock')).toBe(true);
    expect(loginActivityEventFixtures.some((e) => e.identityId === invited.identity.id && e.eventType === 'invitation_accepted')).toBe(true);
  });
});
