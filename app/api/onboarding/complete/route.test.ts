import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures, organizationLocationFixtures, organizationBrandingFixtures } from '@/services/__mocks__/onboardingFixtures';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import {
  startOnboarding,
  createPrimaryLocation,
  assignInitialAdministrator,
  provisionWorkflow,
  seedServiceCatalog,
  markStepCompleted,
} from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `complete-route-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number; workflow: number; catalog: number; location: number; branding: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    session: onboardingSessionFixtures.length,
    workflow: workflowTemplateFixtures.length,
    catalog: serviceCatalogFixtures.length,
    location: organizationLocationFixtures.length,
    branding: organizationBrandingFixtures.length,
  };
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
  workflowTemplateFixtures.length = lengths.workflow;
  serviceCatalogFixtures.length = lengths.catalog;
  organizationLocationFixtures.length = lengths.location;
  organizationBrandingFixtures.length = lengths.branding;
});

async function seedIncompleteSession() {
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

async function seedFullyProvisionedSession() {
  const { organization, session } = await seedIncompleteSession();
  await createPrimaryLocation(
    organization.id,
    { name: 'Main', addressLine1: '1 St', city: 'City', state: 'IL', postalCode: '11111', country: 'US', phone: '(555) 000-1111' },
    idFactory,
    'mock',
  );
  await assignInitialAdministrator(organization.id, 'full-org-admin', idFactory, 'mock');
  await provisionWorkflow(organization.id, { mode: 'starter' }, idFactory, 'mock');
  await seedServiceCatalog(organization.id, idFactory, 'mock');

  let current = session;
  for (const step of ['organization_profile', 'primary_location', 'administrator_account', 'workflow_setup', 'intake_setup', 'services_pricing', 'payments', 'branding'] as const) {
    current = (await markStepCompleted(current, step, 'mock'))!;
  }
  return { organization, session: current };
}

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/onboarding/complete', { method: 'POST', headers, body: JSON.stringify(body) }));
}

describe('POST /api/onboarding/complete', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { session } = await seedIncompleteSession();
    const response = await postRequest({ onboardingSessionId: session.id }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for an unrelated user', async () => {
    const { session } = await seedIncompleteSession();
    mockSession = { user: mockMultiOrgUser };
    expect((await postRequest({ onboardingSessionId: session.id })).status).toBe(403);
  });

  it('returns 422 with the checklist when required configuration is missing', async () => {
    const { session } = await seedIncompleteSession();
    const response = await postRequest({ onboardingSessionId: session.id });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(Array.isArray(body.checklist)).toBe(true);
    expect(body.checklist.some((c: { satisfied: boolean }) => !c.satisfied)).toBe(true);
  });

  it('activates the organization once fully provisioned and reviewed', async () => {
    const { session } = await seedFullyProvisionedSession();
    const response = await postRequest({ onboardingSessionId: session.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.organization.status).toBe('active');
    expect(body.organization.isActive).toBe(true);
    expect(body.onboardingSession.status).toBe('completed');
  });

  it('is idempotent — completing an already-completed session succeeds harmlessly again', async () => {
    const { session } = await seedFullyProvisionedSession();
    await postRequest({ onboardingSessionId: session.id });
    const second = await postRequest({ onboardingSessionId: session.id });
    expect(second.status).toBe(200);
  });
});
