import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures, emailVerificationTokenFixtures } from '@/services/__mocks__/identityFixtures';
import { capturedIdentityMessages } from '@/services/__mocks__/identityMessageSender';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `invitations-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));
vi.mock('@/lib/identity/messageSender', async () => {
  const { capturingIdentityMessageSender } = await import('@/services/__mocks__/identityMessageSender');
  return { getIdentityMessageSender: () => capturingIdentityMessageSender };
});

const { POST, PATCH } = await import('./route');

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/auth/invitations', { method: 'POST', headers, body: JSON.stringify(body) }));
}
function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request('http://localhost/api/auth/invitations', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

let lengths: { identity: number; membership: number; sessions: number; tokens: number; messages: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    tokens: emailVerificationTokenFixtures.length,
    messages: capturedIdentityMessages.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  emailVerificationTokenFixtures.length = lengths.tokens;
  capturedIdentityMessages.length = lengths.messages;
});

async function seedAdminCaller(role: 'owner' | 'administrator' | 'staff' = 'administrator') {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role, status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

describe('POST /api/auth/invitations', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedAdminCaller();
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, email: 'x@example.com', displayName: 'X', role: 'staff' },
      { origin: 'https://evil.example.com', host: 'localhost' },
    );
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'x@example.com', displayName: 'X', role: 'staff' })).status).toBe(401);
  });

  it('returns 400 for an invalid role', async () => {
    await seedAdminCaller();
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'x@example.com', displayName: 'X', role: 'superuser' });
    expect(response.status).toBe(400);
  });

  it('an ordinary staff-tier caller may not invite anyone', async () => {
    await seedAdminCaller('staff');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'x@example.com', displayName: 'X', role: 'staff' });
    expect(response.status).toBe(403);
  });

  it('an administrator can invite a new staff member, sending an invitation message (never the token itself)', async () => {
    await seedAdminCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'new.staff@example.com', displayName: 'New Staff', role: 'staff' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.status).toBe('invited');
    expect(body.invitationToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/token/i);

    const sent = capturedIdentityMessages.find((m) => m.kind === 'invitation' && m.to === 'new.staff@example.com');
    expect(sent).toBeDefined();
    expect(typeof (sent as { token: string }).token).toBe('string');
  });

  it('is idempotent — inviting the same email twice never re-issues a token or sends a second message', async () => {
    await seedAdminCaller('administrator');
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'repeat@example.com', displayName: 'Repeat', role: 'staff' });
    const second = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'repeat@example.com', displayName: 'Repeat', role: 'staff' });
    const body = await second.json();
    expect(body.isNewMembership).toBe(false);
    expect(capturedIdentityMessages.filter((m) => m.to === 'repeat@example.com')).toHaveLength(1);
  });
});

describe('PATCH /api/auth/invitations (regenerate)', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedAdminCaller('owner');
    const response = await patchRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'x', invitedIdentityId: 'y' },
      { origin: 'https://evil.example.com', host: 'localhost' },
    );
    expect(response.status).toBe(403);
  });

  it('regenerates a token for a genuine pending invitation in the caller\'s own organization, sending it rather than returning it', async () => {
    await seedAdminCaller('owner');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'regen.me@example.com', displayName: 'Regen Me', role: 'staff' });
    const inviteBody = await invite.json();

    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id, invitedIdentityId: inviteBody.membership.identityId });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invitationToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/token/i);

    const sent = capturedIdentityMessages.filter((m) => m.kind === 'invitation' && m.to === 'regen.me@example.com');
    expect(sent).toHaveLength(2); // one from the original invite, one from regeneration
  });

  it('rejects a membershipId/invitedIdentityId pair that does not actually belong to the caller\'s organization', async () => {
    await seedAdminCaller('owner');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'fabricated-membership-id', invitedIdentityId: 'fabricated-identity-id' });
    expect(response.status).toBe(404);
  });
});
