import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures } from '@/services/__mocks__/onboardingFixtures';
import { startOnboarding } from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `admin-route-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = { org: mockOrganizationFixtures.length, membership: mockMembershipFixtures.length, session: onboardingSessionFixtures.length };
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
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

function patchRequest(body: unknown) {
  return PATCH(new Request('http://localhost/api/onboarding/administrator', { method: 'PATCH', body: JSON.stringify(body) }));
}

describe('PATCH /api/onboarding/administrator', () => {
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
});
