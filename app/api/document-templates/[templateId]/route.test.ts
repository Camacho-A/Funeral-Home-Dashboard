import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { documentTemplateFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { createTemplate } from '@/services/documentTemplatesService';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `document-template-id-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { PATCH } = await import('./route');

function patchRequest(templateId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/document-templates/${templateId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ templateId }) });
}

let lengths: { identity: number; membership: number; sessions: number; templates: number; events: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    templates: documentTemplateFixtures.length,
    events: activityEventFixtures.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  documentTemplateFixtures.length = lengths.templates;
  activityEventFixtures.length = lengths.events;
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

describe('PATCH /api/document-templates/[templateId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest('t1', { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>x</p>' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('a role without document.template.manage is refused', async () => {
    await seedCaller('funeralDirector');
    const response = await patchRequest('t1', { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>x</p>' });
    expect(response.status).toBe(403);
  });

  it('creates a new version and never mutates the prior one', async () => {
    const template = await createTemplate(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', documentTypeKey: 'obituary', category: 'miscellaneous', body: '<p>v1</p>', idFactory },
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' },
      'mock',
    );
    await seedCaller('manager');

    const response = await patchRequest(template.id, { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>{{case.decedent.fullName}} v2</p>' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.template.versions).toHaveLength(2);
    expect(body.template.versions[0].body).toBe('<p>v1</p>');
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.template.updated');
  });

  it('returns 404 for a template that does not exist', async () => {
    await seedCaller('manager');
    const response = await patchRequest('no-such-template', { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>x</p>' });
    expect(response.status).toBe(404);
  });

  it('rejects a body referencing an unrecognized merge field with 400', async () => {
    const template = await createTemplate(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', documentTypeKey: 'obituary', category: 'miscellaneous', body: '<p>v1</p>', idFactory },
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' },
      'mock',
    );
    await seedCaller('manager');
    const response = await patchRequest(template.id, { organizationId: DEFAULT_ORGANIZATION_ID, body: '<p>{{bogus.field}}</p>' });
    expect(response.status).toBe(400);
  });
});
