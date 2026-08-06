import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';
import type { Case } from '@/types/case';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { GET } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-cases-list-route-test-${idCounter}`;
}

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case-family-list-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-321',
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

let lengths: { users: number; sessions: number; access: number; cases: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length, access: portalAccessFixtures.length, cases: caseFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  caseFixtures.length = lengths.cases;
});

describe('GET /api/family/cases', () => {
  it('returns 401 with no family session', async () => {
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('lists only cases with an active grant for this session\'s portal user', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-cases-list@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };

    caseFixtures.push(makeCase());
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: portalUser.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-family-list-1',
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0].caseNumber).toBe('B2026-321');
    expect(body.cases[0]).not.toHaveProperty('assignedStaffId');
    expect(body.cases[0]).not.toHaveProperty('rawStage');
    expect(body.cases[0]).not.toHaveProperty('checklistState');
    expect(body.cases[0]).not.toHaveProperty('fieldValues');
    expect(body.cases[0]).not.toHaveProperty('createdBy');
    expect(body.cases[0]).not.toHaveProperty('intakeOwnerId');
  });
});
