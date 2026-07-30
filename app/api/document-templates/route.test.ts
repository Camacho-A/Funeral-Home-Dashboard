import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { documentTemplateFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `document-templates-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET, POST } = await import('./route');

function getRequest(organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/document-templates?${params.toString()}`));
}

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/document-templates', { method: 'POST', headers, body: JSON.stringify(body) }));
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

async function seedCaller(role: string, organizationId = DEFAULT_ORGANIZATION_ID) {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId, role, status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

describe('GET /api/document-templates', () => {
  it('returns 401 with no session', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 400 with no organizationId', async () => {
    await seedCaller('administrator');
    expect((await getRequest(null)).status).toBe(400);
  });

  it('a role without document.template.read (e.g. arranger) is refused', async () => {
    await seedCaller('arranger');
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('a role with document.template.read (e.g. funeralDirector) can list templates', async () => {
    await seedCaller('funeralDirector');
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.templates).toEqual([]);
  });

  it('a mock-mode session (AUTH_ADAPTER=mock) can list templates too — the case-scoped Generate Document dialog reads this route from the universal Case Detail page, not just the identity-mode-gated Template Library page', async () => {
    mockSession = { user: mockDefaultUser };
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.templates).toEqual([]);
  });
});

describe('POST /api/document-templates', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedCaller('administrator');
    const response = await postRequest({}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', documentTypeKey: 'obituary', category: 'miscellaneous', body: '<p>x</p>' });
    expect(response.status).toBe(401);
  });

  it('a role without document.template.manage (e.g. funeralDirector) is refused', async () => {
    await seedCaller('funeralDirector');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', documentTypeKey: 'obituary', category: 'miscellaneous', body: '<p>x</p>' });
    expect(response.status).toBe(403);
  });

  it('a role with document.template.manage (e.g. manager) creates a template', async () => {
    await seedCaller('manager');
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: 'Obituary',
      documentTypeKey: 'obituary',
      category: 'miscellaneous',
      body: '<p>{{case.decedent.fullName}}</p>',
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.template.versions).toHaveLength(1);
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.template.created');
  });

  it('rejects an unrecognized documentTypeKey with 400', async () => {
    await seedCaller('manager');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', documentTypeKey: 'not.a.real.key', category: 'miscellaneous', body: '<p>x</p>' });
    expect(response.status).toBe(400);
  });

  it('rejects a body referencing an unrecognized merge field with 400', async () => {
    await seedCaller('manager');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', documentTypeKey: 'obituary', category: 'miscellaneous', body: '<p>{{bogus.field}}</p>' });
    expect(response.status).toBe(400);
  });

  it('cannot create a template for an organization the caller has no membership in', async () => {
    await seedCaller('manager');
    const response = await postRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID, name: 'X', documentTypeKey: 'obituary', category: 'miscellaneous', body: '<p>x</p>' });
    expect(response.status).toBe(403);
  });
});
