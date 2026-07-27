import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures } from '@/services/__mocks__/onboardingFixtures';
import { startOnboarding } from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `org-route-test-${idCounter}`;
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

const PROFILE_PATCH = {
  legalName: 'Updated Legal Name, LLC',
  displayName: 'Updated Display Name',
  primaryEmail: 'updated@testorg.test',
  primaryPhone: '(555) 111-2222',
  timezone: 'America/New_York',
  defaultCurrency: 'usd',
};

function patchRequest(body: unknown) {
  return PATCH(new Request('http://localhost/api/onboarding/organization', { method: 'PATCH', body: JSON.stringify(body) }));
}

describe('PATCH /api/onboarding/organization', () => {

  it('returns 400 when onboardingSessionId is missing', async () => {
    expect((await patchRequest(PROFILE_PATCH)).status).toBe(400);
  });

  it('returns 404 for a nonexistent onboardingSessionId', async () => {
    expect((await patchRequest({ ...PROFILE_PATCH, onboardingSessionId: 'no-such-session' })).status).toBe(404);
  });

  it('returns 403 for a user unrelated to this session', async () => {
    const { session } = await seedSession();
    mockSession = { user: mockMultiOrgUser };
    expect((await patchRequest({ ...PROFILE_PATCH, onboardingSessionId: session.id })).status).toBe(403);
  });

  it('returns field-specific validation errors for an incomplete profile', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ onboardingSessionId: session.id });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.length).toBeGreaterThan(0);
  });

  it('updates the organization profile and marks the step completed', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ ...PROFILE_PATCH, onboardingSessionId: session.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.organization.legalName).toBe('Updated Legal Name, LLC');
    expect(body.organization.name).toBe('Updated Display Name');
    expect(body.onboardingSession.completedSteps).toContain('organization_profile');
    expect(body.onboardingSession.currentStep).toBe('primary_location');
  });
});
