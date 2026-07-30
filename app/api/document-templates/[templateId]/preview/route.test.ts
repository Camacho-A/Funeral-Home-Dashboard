import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { documentTemplateFixtures } from '@/services/__mocks__/documentFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { createTemplate } from '@/services/documentTemplatesService';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `document-template-preview-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession, clearSession: vi.fn() }));

const { POST } = await import('./route');

function previewRequest(templateId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/document-templates/${templateId}/preview`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ templateId }) });
}

let lengths: { identity: number; membership: number; sessions: number; templates: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, sessions: identitySessionFixtures.length, templates: documentTemplateFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  documentTemplateFixtures.length = lengths.templates;
});

async function seedCaller(role: string) {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role, status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}

describe('POST /api/document-templates/[templateId]/preview', () => {
  it('a role without document.template.read (e.g. arranger) is refused', async () => {
    await seedCaller('arranger');
    const response = await previewRequest('t1', { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>{{case.decedent.fullName}}</p>' });
    expect(response.status).toBe(403);
  });

  it('previews an ad hoc body against sample data when no caseId is given', async () => {
    await seedCaller('manager');
    const response = await previewRequest('t1', { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>Dear {{case.primaryContact.fullName}}, re: {{case.decedent.fullName}}</p>' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.html).toContain('Margaret Ellison');
    expect(body.html).toContain('Robert Ellison');
  });

  it('previews the template\'s saved latest version when no ad hoc body is given', async () => {
    const template = await createTemplate(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', documentTypeKey: 'obituary', category: 'miscellaneous', body: '<p>{{organization.name}}</p>', idFactory },
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' },
      'mock',
    );
    await seedCaller('manager');
    const response = await previewRequest(template.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.html).toContain("Manor's Cremation");
  });

  it('rejects an unrecognized merge field with 400', async () => {
    await seedCaller('manager');
    const response = await previewRequest('t1', { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>{{bogus.field}}</p>' });
    expect(response.status).toBe(400);
  });

  it('a mock-mode session (AUTH_ADAPTER=mock) can preview too — the case-scoped Generate Document dialog previews from the universal Case Detail page, not just the identity-mode-gated Template Library page', async () => {
    mockSession = { user: mockDefaultUser };
    const response = await previewRequest('t1', { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>{{case.decedent.fullName}}</p>' });
    expect(response.status).toBe(200);
  });
});
