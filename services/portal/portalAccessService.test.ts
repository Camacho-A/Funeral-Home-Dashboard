import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { portalAccessFixtures } from '../__mocks__/portalFixtures';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `portal-access-test-${idCounter}`;
}

let originalLength: number;
beforeEach(() => {
  idCounter = 0;
  originalLength = portalAccessFixtures.length;
});
afterEach(() => {
  portalAccessFixtures.length = originalLength;
});

describe('portalAccessService', () => {
  it('createPendingPortalAccess creates a pending grant with no portalUserId yet', async () => {
    const { createPendingPortalAccess } = await import('./portalAccessService');
    const access = await createPendingPortalAccess(
      { organizationId: 'org-1', caseId: 'case-1', relationshipType: 'primary_next_of_kin', grantedFromInvitationId: 'invitation-1', idFactory },
      'mock',
    );

    expect(access.status).toBe('pending');
    expect(access.portalUserId).toBeNull();
    expect(access.organizationId).toBe('org-1');
  });

  it('getPortalAccessForPortalUserAndCase returns null before activation', async () => {
    const { createPendingPortalAccess, getPortalAccessForPortalUserAndCase } = await import('./portalAccessService');
    await createPendingPortalAccess(
      { organizationId: 'org-1', caseId: 'case-lookup', relationshipType: 'primary_next_of_kin', grantedFromInvitationId: 'invitation-1', idFactory },
      'mock',
    );

    expect(await getPortalAccessForPortalUserAndCase('portal-user-1', 'case-lookup', 'mock')).toBeNull();
  });

  it('activatePortalAccess sets portalUserId and flips pending -> active; the lookup then finds it', async () => {
    const { createPendingPortalAccess, activatePortalAccess, getPortalAccessForPortalUserAndCase } = await import('./portalAccessService');
    const pending = await createPendingPortalAccess(
      { organizationId: 'org-1', caseId: 'case-activate', relationshipType: 'executor', grantedFromInvitationId: 'invitation-2', idFactory },
      'mock',
    );

    const activated = await activatePortalAccess(pending.id, 'portal-user-9', 'mock');
    expect(activated?.status).toBe('active');
    expect(activated?.portalUserId).toBe('portal-user-9');

    const found = await getPortalAccessForPortalUserAndCase('portal-user-9', 'case-activate', 'mock');
    expect(found?.id).toBe(pending.id);
  });

  it('activation never changes organizationId, caseId, relationshipType, or grantedFromInvitationId', async () => {
    const { createPendingPortalAccess, activatePortalAccess } = await import('./portalAccessService');
    const pending = await createPendingPortalAccess(
      { organizationId: 'org-1', caseId: 'case-fixed', relationshipType: 'authorized_representative', grantedFromInvitationId: 'invitation-3', idFactory },
      'mock',
    );
    const activated = await activatePortalAccess(pending.id, 'portal-user-2', 'mock');

    expect(activated?.organizationId).toBe(pending.organizationId);
    expect(activated?.caseId).toBe(pending.caseId);
    expect(activated?.relationshipType).toBe(pending.relationshipType);
    expect(activated?.grantedFromInvitationId).toBe(pending.grantedFromInvitationId);
  });

  it('disablePortalAccess and revokePortalAccess fail the grant closed', async () => {
    const { createPendingPortalAccess, activatePortalAccess, disablePortalAccess, revokePortalAccess } = await import('./portalAccessService');
    const a = await createPendingPortalAccess(
      { organizationId: 'org-1', caseId: 'case-disable', relationshipType: 'primary_next_of_kin', grantedFromInvitationId: 'invitation-4', idFactory },
      'mock',
    );
    await activatePortalAccess(a.id, 'portal-user-3', 'mock');
    const disabled = await disablePortalAccess(a.id, 'mock');
    expect(disabled?.status).toBe('disabled');

    const b = await createPendingPortalAccess(
      { organizationId: 'org-1', caseId: 'case-revoke', relationshipType: 'primary_next_of_kin', grantedFromInvitationId: 'invitation-5', idFactory },
      'mock',
    );
    await activatePortalAccess(b.id, 'portal-user-4', 'mock');
    const revoked = await revokePortalAccess(b.id, 'mock');
    expect(revoked?.status).toBe('revoked');
  });

  it('expirePortalAccess flips a still-pending grant to expired', async () => {
    const { createPendingPortalAccess, expirePortalAccess } = await import('./portalAccessService');
    const a = await createPendingPortalAccess(
      { organizationId: 'org-1', caseId: 'case-expire', relationshipType: 'primary_next_of_kin', grantedFromInvitationId: 'invitation-6', idFactory },
      'mock',
    );
    const expired = await expirePortalAccess(a.id, 'mock');
    expect(expired?.status).toBe('expired');
  });

  it('listPortalAccessForCase and listPortalAccessForPortalUser scope correctly', async () => {
    const { createPendingPortalAccess, activatePortalAccess, listPortalAccessForCase, listPortalAccessForPortalUser } = await import('./portalAccessService');
    const a = await createPendingPortalAccess(
      { organizationId: 'org-1', caseId: 'case-list', relationshipType: 'primary_next_of_kin', grantedFromInvitationId: 'invitation-7', idFactory },
      'mock',
    );
    await activatePortalAccess(a.id, 'portal-user-5', 'mock');

    const forCase = await listPortalAccessForCase('org-1', 'case-list', 'mock');
    expect(forCase.map((x) => x.id)).toContain(a.id);

    const forUser = await listPortalAccessForPortalUser('portal-user-5', 'mock');
    expect(forUser.map((x) => x.id)).toContain(a.id);
  });

  it('getPrimaryOrganizationIdForPortalUser returns the first active grant\'s organization, or null with none', async () => {
    const { createPendingPortalAccess, activatePortalAccess, getPrimaryOrganizationIdForPortalUser } = await import('./portalAccessService');

    expect(await getPrimaryOrganizationIdForPortalUser('portal-user-6', 'mock')).toBeNull();

    const pending = await createPendingPortalAccess(
      { organizationId: 'org-primary', caseId: 'case-primary', relationshipType: 'primary_next_of_kin', grantedFromInvitationId: 'invitation-8', idFactory },
      'mock',
    );

    await activatePortalAccess(pending.id, 'portal-user-6', 'mock');
    expect(await getPrimaryOrganizationIdForPortalUser('portal-user-6', 'mock')).toBe('org-primary');
  });
});
