import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures } from '@/services/__mocks__/onboardingFixtures';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { startOnboarding } from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `services-route-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number; catalog: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    session: onboardingSessionFixtures.length,
    catalog: serviceCatalogFixtures.length,
  };
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
  serviceCatalogFixtures.length = lengths.catalog;
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
  return PATCH(new Request('http://localhost/api/onboarding/services', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

describe('PATCH /api/onboarding/services', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ onboardingSessionId: session.id }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('seeds a fresh, organization-owned catalog and marks the step completed', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ onboardingSessionId: session.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.catalog).toHaveLength(5);
    expect(body.catalog.every((c: { organizationId: string }) => c.organizationId === session.organizationId)).toBe(true);
    expect(body.onboardingSession.completedSteps).toContain('services_pricing');
  });

  it('never references another organization\'s catalog rows', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ onboardingSessionId: session.id });
    const body = await response.json();
    const manorsIds = new Set(serviceCatalogFixtures.filter((c) => c.organizationId !== session.organizationId).map((c) => c.id));
    expect(body.catalog.some((c: { id: string }) => manorsIds.has(c.id))).toBe(false);
  });
});
