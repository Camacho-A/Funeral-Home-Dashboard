import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';
import type { Case } from '@/types/case';
import type { PortalRelationshipType } from '@/domain/portal/portalRelationshipRegistry';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { GET } = await import('./route');

const TEST_CASE_ID = 'case-family-detail-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-case-detail-route-test-${idCounter}`;
}

function getRequest() {
  return GET(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

async function seedSessionWithGrant(relationshipType: PortalRelationshipType = 'primary_next_of_kin') {
  const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
  const { createPortalSession } = await import('@/services/portal/portalSessionService');
  const { portalUser } = await findOrCreatePortalUser(
    { email: `${idFactory()}@example.com`, displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
    'mock',
  );
  const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
  familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
  portalAccessFixtures.push({
    id: idFactory(),
    portalUserId: portalUser.id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: TEST_CASE_ID,
    relationshipType,
    status: 'active',
    grantedFromInvitationId: 'invitation-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  return portalUser;
}

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-654',
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

describe('GET /api/family/cases/[caseId]', () => {
  it('returns 401 with no family session', async () => {
    expect((await getRequest()).status).toBe(401);
  });

  it('returns 403 when this portal user has no active grant for this case', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'no-grant@example.com', displayName: 'X', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };

    expect((await getRequest()).status).toBe(403);
  });

  it('returns the allowlisting case DTO for an authorized portal user', async () => {
    await seedSessionWithGrant();
    caseFixtures.push(makeCase());

    const response = await getRequest();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.caseNumber).toBe('B2026-654');
    expect(body.case).not.toHaveProperty('nextOfKinPhone');
  });

  it('returns 404 when the case does not exist even though access is granted', async () => {
    await seedSessionWithGrant();
    expect((await getRequest()).status).toBe(404);
  });
});
