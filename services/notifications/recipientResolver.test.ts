import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRecipientIdentityIds, RecipientResolverError } from './recipientResolver';
import { membershipFixtures } from '../__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../__mocks__/organizationIds';
import type { Membership } from '../../types/membership';

function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: `membership-${Math.random()}`,
    identityId: `identity-${Math.random()}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    role: 'officeStaff',
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const originalFixtures = [...membershipFixtures];

beforeEach(() => {
  membershipFixtures.length = 0;
});

afterEach(() => {
  membershipFixtures.length = 0;
  membershipFixtures.push(...originalFixtures);
});

describe('resolveRecipientIdentityIds', () => {
  it('individual scope resolves to exactly the one given identity, with no membership lookup at all', async () => {
    const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'individual', recipientIdentityId: 'identity-42' }, 'mock');
    expect(ids).toEqual(['identity-42']);
  });

  it('individual scope throws when recipientIdentityId is missing', async () => {
    await expect(resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'individual' }, 'mock')).rejects.toThrow(RecipientResolverError);
  });

  it('role scope resolves to every active membership holding that role in the organization, excluding other roles and inactive rows', async () => {
    membershipFixtures.push(
      makeMembership({ identityId: 'fd-1', role: 'funeralDirector', status: 'active' }),
      makeMembership({ identityId: 'fd-2', role: 'funeralDirector', status: 'active' }),
      makeMembership({ identityId: 'fd-3-disabled', role: 'funeralDirector', status: 'disabled' }),
      makeMembership({ identityId: 'other-role', role: 'arranger', status: 'active' }),
    );
    const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'role', recipientRoleKey: 'funeralDirector' }, 'mock');
    expect(ids.sort()).toEqual(['fd-1', 'fd-2']);
  });

  it('role scope throws when recipientRoleKey is missing', async () => {
    await expect(resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'role' }, 'mock')).rejects.toThrow(RecipientResolverError);
  });

  it('organization_wide scope resolves to every active membership, excluding disabled/invited/removed rows', async () => {
    membershipFixtures.push(
      makeMembership({ identityId: 'active-1', status: 'active' }),
      makeMembership({ identityId: 'active-2', status: 'active' }),
      makeMembership({ identityId: 'invited-1', status: 'invited' }),
      makeMembership({ identityId: 'disabled-1', status: 'disabled' }),
    );
    const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'organization_wide' }, 'mock');
    expect(ids.sort()).toEqual(['active-1', 'active-2']);
  });

  it('never crosses tenant boundaries for role/organization_wide scopes', async () => {
    membershipFixtures.push(
      makeMembership({ identityId: 'org-a-member', organizationId: DEFAULT_ORGANIZATION_ID, role: 'officeStaff' }),
      makeMembership({ identityId: 'org-b-member', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'officeStaff' }),
    );
    const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'organization_wide' }, 'mock');
    expect(ids).toEqual(['org-a-member']);
  });

  it('case_participants is reserved but throws — no StaffProfile-to-Identity mapping exists yet', async () => {
    await expect(resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants', caseId: 'case-1' }, 'mock')).rejects.toThrow(
      RecipientResolverError,
    );
  });
});
