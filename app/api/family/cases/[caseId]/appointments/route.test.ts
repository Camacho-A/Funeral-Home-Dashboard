import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { appointmentFixtures } from '@/services/__mocks__/schedulingFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';
import type { Appointment } from '@/types/appointment';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { GET } = await import('./route');

const TEST_CASE_ID = 'case-family-appointments-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-appointments-route-test-${idCounter}`;
}

function getRequest() {
  return GET(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/appointments`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-family-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: TEST_CASE_ID,
    appointmentType: 'family_meeting',
    title: 'Arrangement Conference',
    notes: 'Internal notes',
    locationId: null,
    status: 'scheduled',
    startAt: '2026-08-10T15:00:00.000Z',
    endAt: '2026-08-10T16:00:00.000Z',
    timezone: 'America/Los_Angeles',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'identity-1',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'corr-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

let lengths: { users: number; sessions: number; access: number; appointments: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length, access: portalAccessFixtures.length, appointments: appointmentFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  appointmentFixtures.length = lengths.appointments;
});

describe('GET /api/family/cases/[caseId]/appointments', () => {
  it('returns 401 with no family session', async () => {
    expect((await getRequest()).status).toBe(401);
  });

  it('returns the allowlisted appointment DTOs for an authorized portal user', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-appointments@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: portalUser.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    appointmentFixtures.push(makeAppointment());

    const response = await getRequest();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0].title).toBe('Arrangement Conference');
    expect(body.appointments[0]).not.toHaveProperty('notes');
  });
});
