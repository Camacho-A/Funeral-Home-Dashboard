import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures } from '@/services/__mocks__/onboardingFixtures';
import { startOnboarding } from '@/services/organizationProvisioningService';
import { identityFixtures, membershipFixtures } from '@/services/__mocks__/identityFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
const sentMessages: unknown[] = [];
vi.mock('@/lib/identity/messageSender', () => ({
  getIdentityMessageSender: () => ({ send: async (message: unknown) => void sentMessages.push(message) }),
}));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `admin-route-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number; identity: number; identityMembership: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    session: onboardingSessionFixtures.length,
    identity: identityFixtures.length,
    identityMembership: membershipFixtures.length,
  };
  sentMessages.length = 0;
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.identityMembership;
});

async function seedSession() {
  return startOnboarding(
    {
      idempotencyKey: idFactory(),
      legalName: 'Test Org LLC',
      displayName: 'Test Org',
      primaryEmail: 'staff@testorg.test',
      primaryPhone: '(555) 000-0000',
      timezone: 'America/Chicago',
      defaultCurrency: 'usd',
      actorUserId: mockDefaultUser.id,
      idFactory,
    },
    'mock',
  );
}

function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request('http://localhost/api/onboarding/administrator', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

describe('PATCH /api/onboarding/administrator', () => {
  it('rejects a cross-site request (CSRF) — the same request succeeds same-origin', async () => {
    const { session } = await seedSession();
    const response = await patchRequest(
      { administratorUserId: 'new-admin', onboardingSessionId: session.id },
      { origin: 'https://evil.example.com', host: 'localhost' },
    );
    expect(response.status).toBe(403);
  });

  it('returns 403 for an unrelated user', async () => {
    const { session } = await seedSession();
    mockSession = { user: mockMultiOrgUser };
    expect((await patchRequest({ administratorUserId: 'new-admin', onboardingSessionId: session.id })).status).toBe(403);
  });

  it('returns 400 when administratorUserId is missing', async () => {
    const { session } = await seedSession();
    expect((await patchRequest({ onboardingSessionId: session.id })).status).toBe(400);
  });

  it('assigns the administrator role, ignoring any role the client might try to name', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ administratorUserId: 'new-admin', role: 'owner', onboardingSessionId: session.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.role).toBe('administrator');
    expect(body.onboardingSession.completedSteps).toContain('administrator_account');
  });

  it('is idempotent — a second identical call never creates a duplicate membership', async () => {
    const { session } = await seedSession();
    await patchRequest({ administratorUserId: 'new-admin', onboardingSessionId: session.id });
    await patchRequest({ administratorUserId: 'new-admin', onboardingSessionId: session.id });
    const matches = mockMembershipFixtures.filter((m) => m.organizationId === session.organizationId && m.userId === 'new-admin');
    expect(matches).toHaveLength(1);
  });

  describe('safe onboarding (2026-10)', () => {
    it('an existing identity also gets an ACTIVE identity-format membership (identity login can resolve it)', async () => {
      const { session } = await seedSession();
      const identity = identityFixtures[0];
      const response = await patchRequest({ administratorUserId: identity.id, onboardingSessionId: session.id });
      expect(response.status).toBe(200);
      const identityMembership = membershipFixtures.find((m) => m.organizationId === session.organizationId && m.identityId === identity.id);
      expect(identityMembership).toMatchObject({ role: 'administrator', status: 'active', invitedBy: mockDefaultUser.id });
    });

    it('administratorEmail uses the existing invitation flow: invited membership + invitation message, no active admin yet', async () => {
      const { session } = await seedSession();
      const response = await patchRequest({
        administratorEmail: 'first-admin@gus.test',
        administratorDisplayName: 'First Admin',
        onboardingSessionId: session.id,
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.outcome).toBe('invited');
      expect(body.membership).toMatchObject({ organizationId: session.organizationId, role: 'administrator', status: 'invited' });
      expect(body.onboardingSession.completedSteps).toContain('administrator_account');
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toMatchObject({ kind: 'invitation', to: 'first-admin@gus.test', organizationId: session.organizationId });
    });

    it('400 when inviting by email without a display name', async () => {
      const { session } = await seedSession();
      const response = await patchRequest({ administratorEmail: 'x@gus.test', onboardingSessionId: session.id });
      expect(response.status).toBe(400);
    });
  });
});
