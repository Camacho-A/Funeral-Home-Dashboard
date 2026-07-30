import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { documentTemplateFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { createTemplate } from '@/services/documentTemplatesService';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `document-template-clone-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession, clearSession: vi.fn() }));

const { POST } = await import('./route');

function cloneRequest(templateId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/document-templates/${templateId}/clone`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ templateId }) });
}

let lengths: { identity: number; membership: number; sessions: number; templates: number; events: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, sessions: identitySessionFixtures.length, templates: documentTemplateFixtures.length, events: activityEventFixtures.length };
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

async function seedTemplate() {
  return createTemplate(
    { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Original', documentTypeKey: 'obituary', category: 'miscellaneous', body: '<p>v1</p>', idFactory },
    { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' },
    'mock',
  );
}

describe('POST /api/document-templates/[templateId]/clone', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await cloneRequest('t1', {}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('a role without document.template.manage is refused', async () => {
    const template = await seedTemplate();
    await seedCaller('funeralDirector');
    const response = await cloneRequest(template.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Copy' });
    expect(response.status).toBe(403);
  });

  it('produces an independent template, source untouched', async () => {
    const template = await seedTemplate();
    await seedCaller('manager');
    const response = await cloneRequest(template.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Copy of Original' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.template.id).not.toBe(template.id);
    expect(body.template.name).toBe('Copy of Original');
    expect(documentTemplateFixtures.find((t) => t.id === template.id)?.name).toBe('Original');
  });

  it('returns 404 for a nonexistent source template', async () => {
    await seedCaller('manager');
    const response = await cloneRequest('no-such-template', { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Copy' });
    expect(response.status).toBe(404);
  });
});
