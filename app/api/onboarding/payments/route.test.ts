import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures } from '@/services/__mocks__/onboardingFixtures';
import { paymentIntegrationFixtures } from '@/services/__mocks__/paymentFixtures';
import { startOnboarding } from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `payments-route-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number; payment: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    session: onboardingSessionFixtures.length,
    payment: paymentIntegrationFixtures.length,
  };
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
  paymentIntegrationFixtures.length = lengths.payment;
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
  return PATCH(new Request('http://localhost/api/onboarding/payments', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

describe('PATCH /api/onboarding/payments', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ choice: 'not_configured', onboardingSessionId: session.id }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 400 for an invalid choice', async () => {
    const { session } = await seedSession();
    expect((await patchRequest({ choice: 'bogus', onboardingSessionId: session.id })).status).toBe(400);
  });

  it('creates a disabled Clover placeholder and reports "Clover not configured"', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ choice: 'clover', merchantIdReference: 'CLOVER_TEST_ID', onboardingSessionId: session.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.integration.isEnabled).toBe(false);
    expect(body.readiness).toBe('Clover not configured');
    expect(body.onboardingSession.completedSteps).toContain('payments');
  });

  it('creates no integration row for not_configured, but still marks the step reviewed', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ choice: 'not_configured', onboardingSessionId: session.id });
    const body = await response.json();
    expect(body.integration).toBeNull();
    expect(body.readiness).toBe('Clover not configured');
    expect(body.onboardingSession.completedSteps).toContain('payments');
  });

  it('never accepts or persists a raw credential value — only reference names', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({
      choice: 'clover',
      merchantIdReference: 'CLOVER_TEST_ID',
      credentialReference: 'CLOVER_TEST_PRIVATE_KEY',
      onboardingSessionId: session.id,
    });
    const body = await response.json();
    expect(body.integration.credentialReference).toBe('CLOVER_TEST_PRIVATE_KEY');
    expect(JSON.stringify(body.integration)).not.toContain('sk_live');
  });
});
