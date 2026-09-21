import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures, emailVerificationTokenFixtures } from '@/services/__mocks__/identityFixtures';
import { organizationRoleAuditEntryFixtures } from '@/services/__mocks__/rbacFixtures';
import { capturedIdentityMessages, forceNextSendToFail, clearForcedSendFailure } from '@/services/__mocks__/identityMessageSender';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `invitations-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(),
  clearSession: vi.fn(),
}));
vi.mock('@/lib/identity/messageSender', async () => {
  const { capturingIdentityMessageSender } = await import('@/services/__mocks__/identityMessageSender');
  return { getIdentityMessageSender: () => capturingIdentityMessageSender };
});

const { GET, POST, PATCH, DELETE } = await import('./route');

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/auth/invitations', { method: 'POST', headers, body: JSON.stringify(body) }));
}
function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request('http://localhost/api/auth/invitations', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}
function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/auth/invitations?organizationId=${organizationId}`, { method: 'GET' }));
}
function deleteRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return DELETE(new Request('http://localhost/api/auth/invitations', { method: 'DELETE', headers, body: JSON.stringify(body) }));
}

let lengths: { identity: number; membership: number; sessions: number; tokens: number; messages: number; audit: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  clearForcedSendFailure();
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    tokens: emailVerificationTokenFixtures.length,
    messages: capturedIdentityMessages.length,
    audit: organizationRoleAuditEntryFixtures.length,
  };
});
afterEach(() => {
  clearForcedSendFailure();
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  emailVerificationTokenFixtures.length = lengths.tokens;
  capturedIdentityMessages.length = lengths.messages;
  organizationRoleAuditEntryFixtures.length = lengths.audit;
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

  it('Manors role-model correction (2026-09): returns 400 when inviting with role Arranger — a real platform role, never enabled for Manors', async () => {
    await seedAdminCaller();
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'x@example.com', displayName: 'X', role: 'arranger' });
    expect(response.status).toBe(400);
  });

  it('allows inviting with role Accounting — one of Manors\' seven required roles', async () => {
    await seedAdminCaller();
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'new.accounting@example.com', displayName: 'New Accounting', role: 'accounting' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.role).toBe('accounting');
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
    expect(body.outcome).toBe('invited');
    expect(body.membership.status).toBe('invited');
    expect(body.invitationToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/token/i);

    const sent = capturedIdentityMessages.find((m) => m.kind === 'invitation' && m.to === 'new.staff@example.com');
    expect(sent).toBeDefined();
    expect(typeof (sent as { token: string }).token).toBe('string');
  });

  it('is idempotent — inviting an already-invited email again never duplicates the membership, never re-issues a token, and returns an explicit 409 rather than a false success', async () => {
    await seedAdminCaller('administrator');
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'repeat@example.com', displayName: 'Repeat', role: 'staff' });
    const second = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'repeat@example.com', displayName: 'Repeat', role: 'staff' });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.outcome).toBe('already_invited');
    expect(typeof body.error).toBe('string');
    expect(capturedIdentityMessages.filter((m) => m.to === 'repeat@example.com')).toHaveLength(1);
  });

  it('Manors go-live fix: an already-active member cannot be re-invited — 409, no new membership, no email', async () => {
    await seedAdminCaller('administrator');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'already.active.route@example.com', displayName: 'Active', role: 'staff' });
    const inviteBody = await invite.json();
    const sentInvite = capturedIdentityMessages.find((m) => m.kind === 'invitation' && m.to === 'already.active.route@example.com') as { token: string };

    const { acceptInvitation } = await import('@/services/invitationService');
    await acceptInvitation({ token: sentInvite.token, membershipId: inviteBody.membership.id, password: 'Active1!', idFactory }, 'mock');

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'already.active.route@example.com', displayName: 'Active', role: 'staff' });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.outcome).toBe('already_active');
    expect(capturedIdentityMessages.filter((m) => m.to === 'already.active.route@example.com')).toHaveLength(1); // only the original
  });

  it('Manors go-live fix: a disabled membership is not silently reactivated by re-inviting — 409, explicit outcome', async () => {
    await seedAdminCaller('administrator');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'disabled.route@example.com', displayName: 'Disabled', role: 'staff' });
    const inviteBody = await invite.json();

    const { updateMembership } = await import('@/services/membershipService');
    await updateMembership(inviteBody.membership.id, { status: 'disabled' }, 'mock');

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'disabled.route@example.com', displayName: 'Disabled', role: 'staff' });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.outcome).toBe('disabled');
    expect(membershipFixtures.find((m) => m.id === inviteBody.membership.id)?.status).toBe('disabled'); // unchanged
  });

  it('Manors go-live fix: re-inviting a previously removed membership reactivates it with the newly selected role and sends a fresh invitation', async () => {
    await seedAdminCaller('administrator');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'removed.route@example.com', displayName: 'Removed', role: 'staff' });
    const inviteBody = await invite.json();

    const { revokeInvitation } = await import('@/services/invitationService');
    await revokeInvitation({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id, actorIdentityId: 'irrelevant-for-this-test', idFactory: () => 'audit-id' }, 'mock');
    expect(membershipFixtures.find((m) => m.id === inviteBody.membership.id)?.status).toBe('removed');

    const membershipCountBefore = membershipFixtures.length;
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'removed.route@example.com', displayName: 'Removed', role: 'manager' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe('reactivated');
    expect(body.membership.id).toBe(inviteBody.membership.id); // same row, no duplicate
    expect(body.membership.status).toBe('invited');
    expect(body.membership.role).toBe('manager');
    expect(membershipFixtures).toHaveLength(membershipCountBefore); // no new row created

    const sentAfterReinvite = capturedIdentityMessages.filter((m) => m.kind === 'invitation' && m.to === 'removed.route@example.com');
    expect(sentAfterReinvite).toHaveLength(2); // original + the reactivation's fresh send
    expect((sentAfterReinvite[1] as { token: string }).token).not.toBe((sentAfterReinvite[0] as { token: string }).token);
  });

  it('Fix C: an email provider failure does not return a false-success response — the membership is still created, but the response is a clear error', async () => {
    await seedAdminCaller('administrator');
    forceNextSendToFail('Resend send failed (HTTP 422).');

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'delivery.fails@example.com', displayName: 'Delivery Fails', role: 'staff' });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/could not be sent/i);
    // The membership genuinely exists — a future Resend can pick it up.
    expect(body.membership.status).toBe('invited');
    expect(membershipFixtures.find((m) => m.id === body.membership.id)?.status).toBe('invited');
    // Never leak the actual token, the API key, or a raw provider payload.
    expect(JSON.stringify(body)).not.toMatch(/RESEND_API_KEY/i);
    expect(JSON.stringify(body)).not.toMatch(/re_[a-zA-Z0-9]/); // a plausible Resend key shape
  });

  it('Fix C: missing/unconfigured email provider fails clearly rather than claiming success', async () => {
    await seedAdminCaller('administrator');
    forceNextSendToFail('No identity message provider is configured for production. Beacon has no transactional email integration yet.');

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'no.provider@example.com', displayName: 'No Provider', role: 'staff' });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toMatch(/could not be sent/i);
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

  it('returns 401 with no session', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'x', invitedIdentityId: 'y' });
    expect(response.status).toBe(401);
  });

  it('an ordinary staff-tier caller may not resend invitations', async () => {
    await seedAdminCaller('staff');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'x', invitedIdentityId: 'y' });
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

  it('Fix A: rejects resend for a removed (revoked) membership — no new token minted, no email sent, an explicit error rather than silent success', async () => {
    await seedAdminCaller('owner');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'resend.removed@example.com', displayName: 'Resend Removed', role: 'staff' });
    const inviteBody = await invite.json();

    const { revokeInvitation } = await import('@/services/invitationService');
    await revokeInvitation({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id, actorIdentityId: 'irrelevant', idFactory: () => 'audit-id' }, 'mock');

    const tokenCountBefore = emailVerificationTokenFixtures.length;
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id, invitedIdentityId: inviteBody.membership.identityId });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/removed/i);

    // No fresh token was minted for the removed membership.
    expect(emailVerificationTokenFixtures).toHaveLength(tokenCountBefore);
    // No second invitation email was sent.
    expect(capturedIdentityMessages.filter((m) => m.to === 'resend.removed@example.com')).toHaveLength(1); // only the original
  });

  it('Fix A: rejects resend for an already-active membership, explicitly', async () => {
    await seedAdminCaller('owner');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'resend.active@example.com', displayName: 'Resend Active', role: 'staff' });
    const inviteBody = await invite.json();
    const sentInvite = capturedIdentityMessages.find((m) => m.kind === 'invitation' && m.to === 'resend.active@example.com') as { token: string };

    const { acceptInvitation } = await import('@/services/invitationService');
    await acceptInvitation({ token: sentInvite.token, membershipId: inviteBody.membership.id, password: 'Active1!', idFactory }, 'mock');

    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id, invitedIdentityId: inviteBody.membership.identityId });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/active/i);
  });

  it('Fix A: rejects resend for a disabled membership, explicitly', async () => {
    await seedAdminCaller('owner');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'resend.disabled@example.com', displayName: 'Resend Disabled', role: 'staff' });
    const inviteBody = await invite.json();

    const { updateMembership } = await import('@/services/membershipService');
    await updateMembership(inviteBody.membership.id, { status: 'disabled' }, 'mock');

    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id, invitedIdentityId: inviteBody.membership.identityId });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/disabled/i);
  });

  it('Fix C: a resend delivery failure does not return a false success — token is regenerated, but the response is a clear error', async () => {
    await seedAdminCaller('owner');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'resend.delivery.fails@example.com', displayName: 'Resend Delivery Fails', role: 'staff' });
    const inviteBody = await invite.json();

    forceNextSendToFail('Resend send failed (HTTP 500).');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id, invitedIdentityId: inviteBody.membership.identityId });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toMatch(/could not be sent/i);
    expect(JSON.stringify(body)).not.toMatch(/RESEND_API_KEY/i);
  });
});

describe('GET /api/auth/invitations (Phase 23: list pending invitations)', () => {
  it('returns 401 with no session', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('an ordinary staff-tier caller may not list pending invitations', async () => {
    await seedAdminCaller('staff');
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('lists a pending invitation with the fields the Team page needs, excluding another organization\'s invitations', async () => {
    await seedAdminCaller('administrator');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'list.pending@example.com', displayName: 'List Pending', role: 'staff' });
    const inviteBody = await invite.json();

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    const row = body.invitations.find((i: { membershipId: string }) => i.membershipId === inviteBody.membership.id);
    expect(row).toBeTruthy();
    expect(row.email).toBe('list.pending@example.com');
    expect(row.status).toBe('pending');
    expect(JSON.stringify(body)).not.toMatch(/tokenHash/i);
  });
});

describe('DELETE /api/auth/invitations (Phase 23: revoke)', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedAdminCaller('owner');
    const response = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'x' }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    expect((await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'x' })).status).toBe(401);
  });

  it('an ordinary staff-tier caller may not revoke invitations', async () => {
    await seedAdminCaller('staff');
    const response = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'x' });
    expect(response.status).toBe(403);
  });

  it('revokes a genuine pending invitation and records an audit entry', async () => {
    await seedAdminCaller('owner');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'revoke.route@example.com', displayName: 'Revoke Route', role: 'staff' });
    const inviteBody = await invite.json();

    const response = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.status).toBe('removed');

    expect(
      organizationRoleAuditEntryFixtures.some((e) => e.targetIdentityId === inviteBody.membership.identityId && e.action === 'invitation_revoked'),
    ).toBe(true);
  });

  it('is idempotent when the invitation was already revoked', async () => {
    await seedAdminCaller('owner');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'revoke.route.twice@example.com', displayName: 'Revoke Twice', role: 'staff' });
    const inviteBody = await invite.json();

    const first = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id });
    expect(first.status).toBe(200);
    const second = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id });
    expect(second.status).toBe(200);
  });

  it('refuses to revoke an already-accepted invitation (409), leaving the active member untouched', async () => {
    await seedAdminCaller('owner');
    const invite = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'revoke.accepted@example.com', displayName: 'Revoke Accepted', role: 'staff' });
    const inviteBody = await invite.json();
    const sent = capturedIdentityMessages.find((m) => m.kind === 'invitation' && m.to === 'revoke.accepted@example.com') as { token: string };

    const { acceptInvitation } = await import('@/services/invitationService');
    await acceptInvitation({ token: sent.token, membershipId: inviteBody.membership.id, password: 'Accepted1!', idFactory }, 'mock');

    const response = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: inviteBody.membership.id });
    expect(response.status).toBe(409);
  });

  it('returns 404 for an unknown membershipId', async () => {
    await seedAdminCaller('owner');
    const response = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'fabricated-membership-id' });
    expect(response.status).toBe(404);
  });

  it('returns 404 for a genuine pending invitation belonging to a different organization', async () => {
    await seedAdminCaller('owner');

    // A genuinely pending invitation, but scoped to a different
    // organization than the caller's own — constructed directly via the
    // service layer since the caller (a DEFAULT_ORGANIZATION_ID member) is
    // not authorized to invite into SECOND_MOCK_ORGANIZATION_ID through the
    // route itself; this isolates the DELETE route's own cross-org check.
    const { createMembership } = await import('@/services/membershipService');
    const { findOrCreateIdentity } = await import('@/services/identityService');
    const { identity } = await findOrCreateIdentity({ email: 'cross.org.revoke.route@example.com', displayName: 'Cross Org', idFactory }, 'mock');
    const { membership } = await createMembership(
      { identityId: identity.id, organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'staff', status: 'invited', invitedBy: null, idFactory },
      'mock',
    );

    const response = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, membershipId: membership.id });
    expect(response.status).toBe(404);
  });
});
