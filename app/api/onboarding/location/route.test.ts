import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures, organizationLocationFixtures } from '@/services/__mocks__/onboardingFixtures';
import { startOnboarding } from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `location-route-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number; location: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    session: onboardingSessionFixtures.length,
    location: organizationLocationFixtures.length,
  };
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
  organizationLocationFixtures.length = lengths.location;
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

const LOCATION_INPUT = {
  name: 'Main Office',
  addressLine1: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'US',
  phone: '(555) 000-0000',
};

function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request('http://localhost/api/onboarding/location', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

describe('PATCH /api/onboarding/location', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ ...LOCATION_INPUT, onboardingSessionId: session.id }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for an unrelated user', async () => {
    const { session } = await seedSession();
    mockSession = { user: mockMultiOrgUser };
    expect((await patchRequest({ ...LOCATION_INPUT, onboardingSessionId: session.id })).status).toBe(403);
  });

  it('returns field-specific validation errors for missing fields', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ onboardingSessionId: session.id });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.length).toBeGreaterThan(0);
  });

  it('creates the primary location and marks the step completed', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ ...LOCATION_INPUT, onboardingSessionId: session.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.location.isPrimary).toBe(true);
    expect(body.onboardingSession.completedSteps).toContain('primary_location');
  });

  it('is idempotent — a second PATCH never creates a second primary location', async () => {
    const { session } = await seedSession();
    await patchRequest({ ...LOCATION_INPUT, onboardingSessionId: session.id });
    await patchRequest({ ...LOCATION_INPUT, name: 'Different Name', onboardingSessionId: session.id });
    const locations = organizationLocationFixtures.filter((l) => l.organizationId === session.organizationId);
    expect(locations).toHaveLength(1);
    expect(locations[0].name).toBe('Main Office');
  });
});
