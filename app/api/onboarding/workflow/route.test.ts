import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { onboardingSessionFixtures } from '@/services/__mocks__/onboardingFixtures';
import { workflowTemplateFixtures, STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import { startOnboarding } from '@/services/organizationProvisioningService';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `workflow-route-test-${idCounter}`;
}

let lengths: { org: number; membership: number; session: number; workflow: number };

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    session: onboardingSessionFixtures.length,
    workflow: workflowTemplateFixtures.length,
  };
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  onboardingSessionFixtures.length = lengths.session;
  workflowTemplateFixtures.length = lengths.workflow;
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
  return PATCH(new Request('http://localhost/api/onboarding/workflow', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

describe('PATCH /api/onboarding/workflow', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ mode: 'starter', onboardingSessionId: session.id }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for an unrelated user', async () => {
    const { session } = await seedSession();
    mockSession = { user: mockMultiOrgUser };
    expect((await patchRequest({ mode: 'starter', onboardingSessionId: session.id })).status).toBe(403);
  });

  it('returns 400 for an invalid mode', async () => {
    const { session } = await seedSession();
    expect((await patchRequest({ mode: 'bogus', onboardingSessionId: session.id })).status).toBe(400);
  });

  it('returns 400 for clone_existing with no sourceTemplateId', async () => {
    const { session } = await seedSession();
    expect((await patchRequest({ mode: 'clone_existing', onboardingSessionId: session.id })).status).toBe(400);
  });

  it('provisions the starter workflow and marks the step completed', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ mode: 'starter', onboardingSessionId: session.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workflowTemplate.organizationId).toBe(session.organizationId);
    expect(body.onboardingSession.completedSteps).toContain('workflow_setup');
  });

  it('clones an existing approved template by value', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ mode: 'clone_existing', sourceTemplateId: STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, onboardingSessionId: session.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workflowTemplate.id).not.toBe(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID);
    expect(body.workflowTemplate.organizationId).toBe(session.organizationId);
  });

  it('returns 422 for a nonexistent sourceTemplateId', async () => {
    const { session } = await seedSession();
    const response = await patchRequest({ mode: 'clone_existing', sourceTemplateId: 'no-such-template', onboardingSessionId: session.id });
    expect(response.status).toBe(422);
  });
});
