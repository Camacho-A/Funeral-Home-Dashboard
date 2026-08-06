import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { portalInvitationFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const sentMessages: unknown[] = [];
vi.mock('@/lib/identity/messageSender', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identity/messageSender')>('@/lib/identity/messageSender');
  return {
    ...actual,
    getIdentityMessageSender: () => ({
      send: async (message: unknown) => {
        sentMessages.push(message);
      },
    }),
  };
});

const { GET, POST } = await import('./route');

const TEST_CASE_ID = 'case-portal-invitations-route-test';

function listRequest(organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/portal-invitations?${params.toString()}`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

function createRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/portal-invitations`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID }),
  });
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  sentMessages.length = 0;
  portalInvitationFixtures.length = 0;
  portalAccessFixtures.length = 0;
});
afterEach(() => {
  portalInvitationFixtures.length = 0;
  portalAccessFixtures.length = 0;
});

describe('GET /api/cases/[caseId]/portal-invitations', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await listRequest(null)).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await listRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('a role without portal.manage (funeralDirector) is refused', async () => {
    const fdUser = { id: 'mock-user-fd-portal-test', email: 'fd-portal@beacon.test', displayName: 'FD Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: fdUser.id, role: 'funeralDirector', isActive: true } as never);
    mockSession = { user: fdUser };

    expect((await listRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('lists pending invitations for the case', async () => {
    await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'family@example.com', displayName: 'Pat Family', relationshipType: 'primary_next_of_kin' });

    const response = await listRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invitations).toHaveLength(1);
    expect(body.invitations[0].email).toBe('family@example.com');
  });
});

describe('POST /api/cases/[caseId]/portal-invitations', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await createRequest({}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'family@example.com', displayName: 'Pat', relationshipType: 'primary_next_of_kin' });
    expect(response.status).toBe(401);
  });

  it('rejects an invalid email', async () => {
    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'not-an-email', displayName: 'Pat', relationshipType: 'primary_next_of_kin' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid relationshipType', async () => {
    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'family@example.com', displayName: 'Pat', relationshipType: 'bogus' });
    expect(response.status).toBe(400);
  });

  it('rejects a reserved (not-yet-implemented) relationshipType', async () => {
    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'family@example.com', displayName: 'Pat', relationshipType: 'attorney' });
    expect(response.status).toBe(422);
  });

  it('returns 403 for a forged organizationId the caller has no membership in', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await createRequest({ organizationId: 'org-with-no-membership', email: 'family@example.com', displayName: 'Pat', relationshipType: 'primary_next_of_kin' });
    expect(response.status).toBe(403);
  });

  it('a role without portal.manage (funeralDirector) is refused', async () => {
    const fdUser = { id: 'mock-user-fd-portal-test-2', email: 'fd-portal-2@beacon.test', displayName: 'FD Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: fdUser.id, role: 'funeralDirector', isActive: true } as never);
    mockSession = { user: fdUser };

    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'family@example.com', displayName: 'Pat', relationshipType: 'primary_next_of_kin' });
    expect(response.status).toBe(403);
    mockMembershipFixtures.pop();
  });

  it('issues an invitation, creates its linked pending PortalAccess, and sends the email — never returning the raw token', async () => {
    const response = await createRequest({ organizationId: DEFAULT_ORGANIZATION_ID, email: 'family@example.com', displayName: 'Pat Family', relationshipType: 'primary_next_of_kin' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.invitation.status).toBe('pending');
    expect(JSON.stringify(body)).not.toContain('"token"');
    expect(JSON.stringify(body)).not.toMatch(/rawToken/);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({ kind: 'portal_invitation', to: 'family@example.com' });

    const linkedAccess = portalAccessFixtures.find((a) => a.id === body.invitation.linkedPortalAccessId);
    expect(linkedAccess?.status).toBe('pending');
  });
});
