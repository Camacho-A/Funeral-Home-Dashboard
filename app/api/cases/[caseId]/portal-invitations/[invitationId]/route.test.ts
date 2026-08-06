import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { portalInvitationFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
vi.mock('@/lib/identity/messageSender', () => ({ getIdentityMessageSender: () => ({ send: async () => undefined }) }));

const { DELETE } = await import('./route');
const { POST: createInvitation } = await import('../route');

const TEST_CASE_ID = 'case-portal-invitation-delete-route-test';

function revokeRequest(invitationId: string, organizationId: string | null, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return DELETE(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/portal-invitations/${invitationId}?${params.toString()}`, { method: 'DELETE', headers }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID, invitationId }),
  });
}

async function seedInvitation() {
  const response = await createInvitation(
    new Request(`http://localhost/api/cases/${TEST_CASE_ID}/portal-invitations`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'family@example.com', displayName: 'Pat Family', relationshipType: 'primary_next_of_kin' }),
    }),
    { params: Promise.resolve({ caseId: TEST_CASE_ID }) },
  );
  const body = await response.json();
  return body.invitation;
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  portalInvitationFixtures.length = 0;
  portalAccessFixtures.length = 0;
  activityEventFixtures.length = 0;
});
afterEach(() => {
  portalInvitationFixtures.length = 0;
  portalAccessFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('DELETE /api/cases/[caseId]/portal-invitations/[invitationId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const invitation = await seedInvitation();
    const response = await revokeRequest(invitation.id, DEFAULT_ORGANIZATION_ID, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    const invitation = await seedInvitation();
    mockSession = null;
    expect((await revokeRequest(invitation.id, DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('a role without portal.manage (funeralDirector) is refused', async () => {
    const invitation = await seedInvitation();
    const fdUser = { id: 'mock-user-fd-revoke-test', email: 'fd-revoke@beacon.test', displayName: 'FD Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: fdUser.id, role: 'funeralDirector', isActive: true } as never);
    mockSession = { user: fdUser };

    expect((await revokeRequest(invitation.id, DEFAULT_ORGANIZATION_ID)).status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('returns 404 for a nonexistent invitation', async () => {
    expect((await revokeRequest('no-such-invitation', DEFAULT_ORGANIZATION_ID)).status).toBe(404);
  });

  it('revokes the invitation and its linked PortalAccess grant', async () => {
    const invitation = await seedInvitation();
    const response = await revokeRequest(invitation.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invitation.status).toBe('revoked');

    const linkedAccess = portalAccessFixtures.find((a) => a.id === invitation.linkedPortalAccessId);
    expect(linkedAccess?.status).toBe('revoked');
    expect(activityEventFixtures.some((e) => e.eventType === 'portal.access_revoked')).toBe(true);
  });

  it('is idempotent on an already-revoked invitation', async () => {
    const invitation = await seedInvitation();
    await revokeRequest(invitation.id, DEFAULT_ORGANIZATION_ID);
    const second = await revokeRequest(invitation.id, DEFAULT_ORGANIZATION_ID);
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.invitation.status).toBe('revoked');
  });
});
