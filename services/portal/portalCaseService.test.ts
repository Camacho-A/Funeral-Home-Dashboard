import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { caseFixtures } from '../__mocks__/fixtures';
import { portalAccessFixtures } from '../__mocks__/portalFixtures';
import { DEFAULT_ORGANIZATION_ID } from '../__mocks__/organizationIds';
import type { Case } from '../../types/case';

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case-portal-case-service-test',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-555',
    decedentName: 'Test Decedent',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '01/01/2026',
    timeOfDeath: '',
    placeOfDeath: '',
    weight: '',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: '',
    nextOfKinPhone: '',
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

let lengths: { cases: number; access: number };
beforeEach(() => {
  lengths = { cases: caseFixtures.length, access: portalAccessFixtures.length };
});
afterEach(() => {
  caseFixtures.length = lengths.cases;
  portalAccessFixtures.length = lengths.access;
});

describe('portalCaseService', () => {
  describe('getFamilyCase', () => {
    it('returns the allowlisting DTO for an existing case', async () => {
      caseFixtures.push(makeCase());
      const { getFamilyCase } = await import('./portalCaseService');
      const view = await getFamilyCase(DEFAULT_ORGANIZATION_ID, 'case-portal-case-service-test', 'mock');
      expect(view?.caseNumber).toBe('B2026-555');
      expect(view).not.toHaveProperty('nextOfKinPhone');
    });

    it('returns null for a nonexistent or deleted case', async () => {
      const { getFamilyCase } = await import('./portalCaseService');
      expect(await getFamilyCase(DEFAULT_ORGANIZATION_ID, 'no-such-case', 'mock')).toBeNull();

      caseFixtures.push(makeCase({ id: 'case-deleted', isDeleted: true }));
      expect(await getFamilyCase(DEFAULT_ORGANIZATION_ID, 'case-deleted', 'mock')).toBeNull();
    });
  });

  describe('listFamilyCases', () => {
    it('lists only cases with an active grant, excluding pending/disabled/revoked ones', async () => {
      caseFixtures.push(makeCase({ id: 'case-active' }), makeCase({ id: 'case-pending' }), makeCase({ id: 'case-revoked' }));
      portalAccessFixtures.push(
        { id: 'access-1', portalUserId: 'portal-user-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-active', relationshipType: 'primary_next_of_kin', status: 'active', grantedFromInvitationId: 'inv-1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
        { id: 'access-2', portalUserId: 'portal-user-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-pending', relationshipType: 'primary_next_of_kin', status: 'pending', grantedFromInvitationId: 'inv-2', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
        { id: 'access-3', portalUserId: 'portal-user-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-revoked', relationshipType: 'primary_next_of_kin', status: 'revoked', grantedFromInvitationId: 'inv-3', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      );

      const { listFamilyCases } = await import('./portalCaseService');
      const cases = await listFamilyCases('portal-user-1', 'mock');
      expect(cases.map((c) => c.id)).toEqual(['case-active']);
    });

    it('returns an empty list for a portal user with no grants', async () => {
      const { listFamilyCases } = await import('./portalCaseService');
      expect(await listFamilyCases('portal-user-no-grants', 'mock')).toEqual([]);
    });
  });
});
