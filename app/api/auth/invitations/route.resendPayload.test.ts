import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures, emailVerificationTokenFixtures } from '@/services/__mocks__/identityFixtures';
import { organizationRoleAuditEntryFixtures } from '@/services/__mocks__/rbacFixtures';
import { mockOrganizationFixtures } from '@/services/__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/**
 * Sender display-name root-cause follow-up (2026-10). The existing
 * `app/api/auth/invitations/route.test.ts` mocks `@/lib/identity/messageSender`
 * entirely (`capturingIdentityMessageSender`), which proves the route calls
 * the message sender correctly but never exercises the REAL
 * `resendIdentityMessageSender` -> `sendResendEmail` -> `fetch('https://api.resend.com/emails')`
 * path at all — so it could never have caught a From-header bug, and
 * doesn't prove one is fixed. This file deliberately does NOT mock
 * `@/lib/identity/messageSender` — only `@/lib/auth/session` (for auth) and
 * `global.fetch` (the actual outbound HTTP boundary, the only network call
 * either handler can reach once `RESEND_API_KEY` is configured) — so the
 * captured request body IS the literal JSON Resend would receive.
 */
let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `invitations-resend-payload-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(),
  clearSession: vi.fn(),
}));

const { POST, PATCH } = await import('./route');

function postRequest(body: unknown) {
  return POST(new Request('http://localhost/api/auth/invitations', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: JSON.stringify(body) }));
}
function patchRequest(body: unknown) {
  return PATCH(new Request('http://localhost/api/auth/invitations', { method: 'PATCH', headers: { origin: 'http://localhost', host: 'localhost' }, body: JSON.stringify(body) }));
}

async function seedAdminCaller() {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'administrator', status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}

let lengths: { identity: number; membership: number; sessions: number; tokens: number; audit: number };
let originalOrgName: string;
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    tokens: emailVerificationTokenFixtures.length,
    audit: organizationRoleAuditEntryFixtures.length,
  };
  // The real production org's stored name is reported as entirely
  // ALL-CAPS ("MANORS CREMATION") — set here so this test also proves
  // the organization-name normalization survives the full real pipeline,
  // not just the resendClient/messageSender unit level.
  const org = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)!;
  originalOrgName = org.name;
  org.name = 'MANORS CREMATION';

  process.env.RESEND_API_KEY = 'fake-resend-key';
  process.env.RESEND_FROM_ADDRESS = 'notifications@mail.manorscremation.com';
  process.env.RESEND_REPLY_TO_ADDRESS = 'angelica@manorscremation.com';
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  emailVerificationTokenFixtures.length = lengths.tokens;
  organizationRoleAuditEntryFixtures.length = lengths.audit;
  const org = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)!;
  org.name = originalOrgName;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_ADDRESS;
  delete process.env.RESEND_REPLY_TO_ADDRESS;
  vi.unstubAllGlobals();
});

describe('POST/PATCH /api/auth/invitations — real outbound Resend payload (no messageSender mock)', () => {
  it('initial invitation: the exact JSON body sent to Resend has the correct from/reply_to/subject', async () => {
    await seedAdminCaller();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'new.hire@example.com', displayName: 'New Hire', role: 'staff' });
    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.anything());
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.from).toBe('SOLIS <notifications@mail.manorscremation.com>');
    expect(sentBody.reply_to).toBe('angelica@manorscremation.com');
    expect(sentBody.subject).toBe("You've been invited to join Manors Cremation on SOLIS");
  });

  it('resend invitation: the exact JSON body sent to Resend has the correct from/reply_to/subject — same as initial invite', async () => {
    await seedAdminCaller();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'resend.target@example.com', displayName: 'Resend Target', role: 'staff' });
    const inviteBody = await invite.json();
    fetchMock.mockClear();

    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id, invitedIdentityId: inviteBody.membership.identityId });
    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.anything());
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.from).toBe('SOLIS <notifications@mail.manorscremation.com>');
    expect(sentBody.reply_to).toBe('angelica@manorscremation.com');
    expect(sentBody.subject).toBe("You've been invited to join Manors Cremation on SOLIS");
  });
});
