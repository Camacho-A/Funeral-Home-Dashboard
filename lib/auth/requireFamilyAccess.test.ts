import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '../../services/__mocks__/portalFixtures';
import { hashPassword } from '../../lib/identity/passwordHashing';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `require-family-access-test-${idCounter}`;
}

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;

vi.mock('./familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => {},
}));

const { requireFamilyAccess } = await import('./requireFamilyAccess');

let lengths: { users: number; sessions: number; access: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length, access: portalAccessFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
});

async function seedActiveGrant(relationshipType: 'primary_next_of_kin' | 'secondary_family_member', caseId: string, organizationId = 'org-1') {
  const { findOrCreatePortalUser } = await import('../../services/portal/portalUserService');
  const { createPortalSession } = await import('../../services/portal/portalSessionService');
  const { createPendingPortalAccess, activatePortalAccess } = await import('./../../services/portal/portalAccessService');

  const { portalUser } = await findOrCreatePortalUser(
    { email: `${caseId}@example.com`, displayName: 'Family Test', passwordHash: hashPassword('Password123!'), idFactory },
    'mock',
  );
  const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
  const pending = await createPendingPortalAccess(
    { organizationId, caseId, relationshipType, grantedFromInvitationId: 'invitation-1', idFactory },
    'mock',
  );
  await activatePortalAccess(pending.id, portalUser.id, 'mock');

  familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
  return { portalUser, session };
}

describe('requireFamilyAccess', () => {
  it('grants access and derives organizationId/caseId from the PortalAccess row itself', async () => {
    await seedActiveGrant('primary_next_of_kin', 'case-1', 'org-derived');
    const result = await requireFamilyAccess('case-1', 'document.read');

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.organizationId).toBe('org-derived');
      expect(result.caseId).toBe('case-1');
    }
  });

  it('returns 401 when there is no family session at all', async () => {
    const result = await requireFamilyAccess('case-1', 'document.read');
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(401);
  });

  it('returns 403 when no PortalAccess grant exists for this (portalUserId, caseId) pair — a case this user was never granted', async () => {
    await seedActiveGrant('primary_next_of_kin', 'case-a');
    const result = await requireFamilyAccess('case-never-granted', 'document.read');
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('returns 403 for a disabled/revoked grant — fails closed immediately', async () => {
    const { portalUser } = await seedActiveGrant('primary_next_of_kin', 'case-disabled');
    const { listPortalAccessForPortalUser, disablePortalAccess } = await import('../../services/portal/portalAccessService');
    const [access] = await listPortalAccessForPortalUser(portalUser.id, 'mock');
    await disablePortalAccess(access.id, 'mock');

    const result = await requireFamilyAccess('case-disabled', 'document.read');
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('returns 403 when the grant is active but lacks the required capability (e.g. secondary_family_member on payment.pay)', async () => {
    await seedActiveGrant('secondary_family_member', 'case-limited');
    const result = await requireFamilyAccess('case-limited', 'payment.pay');
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('a client-supplied organizationId is never trusted — access is looked up by (portalUserId, caseId) only', async () => {
    // seedActiveGrant never receives an organizationId parameter to requireFamilyAccess at all —
    // this test documents that the function signature itself has no such parameter.
    await seedActiveGrant('primary_next_of_kin', 'case-safe', 'org-real');
    const result = await requireFamilyAccess('case-safe', 'document.read');
    expect(result.authorized).toBe(true);
    if (result.authorized) expect(result.organizationId).toBe('org-real');
  });
});
