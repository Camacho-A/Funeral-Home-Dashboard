import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRecipientIdentityIds, RecipientResolverError } from './recipientResolver';
import { membershipFixtures } from '../__mocks__/identityFixtures';
import { caseFixtures, staffFixtures } from '../__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../__mocks__/organizationIds';
import type { Membership } from '../../types/membership';
import type { Case } from '../../types/case';

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

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case-recipient-resolver-test',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-999',
    decedentName: 'Test Decedent',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '01/01/2026',
    timeOfDeath: '',
    placeOfDeath: '',
    weight: '',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: 'Test NOK',
    nextOfKinPhone: '555-0000',
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    checklistState: {},
    fieldValues: {},
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    workflowTemplateId: 'wf-1',
    workflowTemplateVersion: 1,
    caseType: 'cremation',
    workflowSnapshot: null,
    ...overrides,
  };
}

const originalFixtures = [...membershipFixtures];
const originalCaseFixtures = [...caseFixtures];
const originalStaffFixtures = [...staffFixtures];

beforeEach(() => {
  membershipFixtures.length = 0;
});

afterEach(() => {
  membershipFixtures.length = 0;
  membershipFixtures.push(...originalFixtures);
  caseFixtures.length = 0;
  caseFixtures.push(...originalCaseFixtures);
  staffFixtures.length = 0;
  staffFixtures.push(...originalStaffFixtures);
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

  describe('Phase 30 (Identity Model Hardening & Staff Assignment Unification): case_participants', () => {
    it('throws when caseId is missing', async () => {
      await expect(resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants' }, 'mock')).rejects.toThrow(RecipientResolverError);
    });

    it('resolves both assignedStaffId and intakeOwnerId to their real identityIds, deduplicated', async () => {
      caseFixtures.push(makeCase({ assignedStaffId: 'staff-dana', intakeOwnerId: 'staff-chris' }));
      const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants', caseId: 'case-recipient-resolver-test' }, 'mock');
      expect(ids.sort()).toEqual(['identity-manors-admin', 'identity-manors-chris'].sort());
    });

    it('deduplicates when assignedStaffId and intakeOwnerId are the same staff member', async () => {
      caseFixtures.push(makeCase({ assignedStaffId: 'staff-dana', intakeOwnerId: 'staff-dana' }));
      const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants', caseId: 'case-recipient-resolver-test' }, 'mock');
      expect(ids).toEqual(['identity-manors-admin']);
    });

    it('silently drops a deactivated StaffProfile — never throws (read-side policy)', async () => {
      const index = staffFixtures.findIndex((s) => s.id === 'staff-priya');
      staffFixtures[index] = { ...staffFixtures[index], isActive: false };
      caseFixtures.push(makeCase({ assignedStaffId: 'staff-priya', intakeOwnerId: 'staff-dana' }));
      const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants', caseId: 'case-recipient-resolver-test' }, 'mock');
      expect(ids).toEqual(['identity-manors-admin']);
    });

    it('silently drops a nonexistent StaffProfile.id — never throws (read-side policy)', async () => {
      caseFixtures.push(makeCase({ assignedStaffId: 'staff-does-not-exist', intakeOwnerId: null }));
      const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants', caseId: 'case-recipient-resolver-test' }, 'mock');
      expect(ids).toEqual([]);
    });

    it('returns an empty, non-error result when neither field is set', async () => {
      caseFixtures.push(makeCase({ assignedStaffId: null, intakeOwnerId: null }));
      const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants', caseId: 'case-recipient-resolver-test' }, 'mock');
      expect(ids).toEqual([]);
    });

    it('returns an empty, non-error result when the case does not exist', async () => {
      const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants', caseId: 'case-does-not-exist' }, 'mock');
      expect(ids).toEqual([]);
    });

    it('never crosses tenant boundaries — a case from another organization resolves to nothing', async () => {
      caseFixtures.push(makeCase({ organizationId: SECOND_MOCK_ORGANIZATION_ID, assignedStaffId: 'staff-dana' }));
      const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'case_participants', caseId: 'case-recipient-resolver-test' }, 'mock');
      expect(ids).toEqual([]);
    });
  });

  it('Phase 29: portal_user scope resolves to exactly the one given portal user id, with no membership lookup at all', async () => {
    const ids = await resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'portal_user', recipientPortalUserId: 'portal-user-42' }, 'mock');
    expect(ids).toEqual(['portal-user-42']);
  });

  it('Phase 29: portal_user scope throws when recipientPortalUserId is missing', async () => {
    await expect(resolveRecipientIdentityIds({ organizationId: DEFAULT_ORGANIZATION_ID, recipientScope: 'portal_user' }, 'mock')).rejects.toThrow(RecipientResolverError);
  });
});
