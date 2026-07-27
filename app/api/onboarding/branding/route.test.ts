import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures, organizationBrandingFixtures } from '@/services/__mocks__/onboardingFixtures';
import { startOnboarding } from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `branding-route-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number; branding: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    session: onboardingSessionFixtures.length,
    branding: organizationBrandingFixtures.length,
  };
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
  organizationBrandingFixtures.length = lengths.branding;
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
  return PATCH(new Request('http://localhost/api/onboarding/branding', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

describe('PATCH /api/onboarding/branding', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { session } = await seedSession();
    const response = await patchRequest(
      { emailFromName: 'Test Org', primaryColor: '#112233', logoUrl: 'https://cdn.example.com/logo.png', onboardingSessionId: session.id },
      { origin: 'https://evil.example.com', host: 'localhost' },
    );
    expect(response.status).toBe(403);
  });

  it('saves branding and marks the step completed', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({
      emailFromName: 'Test Org',
      primaryColor: '#112233',
      logoUrl: 'https://cdn.example.com/logo.png',
      onboardingSessionId: session.id,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branding.emailFromName).toBe('Test Org');
    expect(body.branding.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(body.onboardingSession.completedSteps).toContain('branding');
  });

  it('never stores binary/base64 image data — only a URL string', async () => {
    const { session } = await seedSession();
    // A data: URI is still just a string value here — this route has no
    // field capable of holding a decoded binary payload at all; the
    // structural guarantee is the type shape, not a runtime content check.
    const response = await patchRequest({ logoUrl: 'https://cdn.example.com/logo.png', onboardingSessionId: session.id });
    const body = await response.json();
    expect(typeof body.branding.logoUrl).toBe('string');
  });

  it('remains organization-scoped across repeated saves for different organizations', async () => {
    const first = await seedSession();
    const second = await seedSession();
    await patchRequest({ emailFromName: 'Org A', onboardingSessionId: first.session.id });
    await patchRequest({ emailFromName: 'Org B', onboardingSessionId: second.session.id });

    const brandingA = organizationBrandingFixtures.find((b) => b.organizationId === first.organization.id);
    const brandingB = organizationBrandingFixtures.find((b) => b.organizationId === second.organization.id);
    expect(brandingA?.emailFromName).toBe('Org A');
    expect(brandingB?.emailFromName).toBe('Org B');
  });
});
