import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { appointmentFixtures, resourceFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { notificationFixtures } from '@/services/__mocks__/notificationFixtures';
import { appointmentReminderFixtures } from '@/services/__mocks__/schedulingReminderFixtures';
import { calendarFeedTokenFixtures } from '@/services/__mocks__/calendarFixtures';

const { GET } = await import('./route');
const { createAppointment } = await import('@/services/schedulingService');
const { create: createResource } = await import('@/services/resourceService');
const { generateFeedToken, revokeFeedToken } = await import('@/services/calendarFeedTokenService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `route-test-feed-${idCounter}`;
}

const SEED_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' };

function feedRequest(token: string) {
  return GET(new Request(`http://localhost/api/calendar-feed/${token}`), { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  idCounter = 0;
  appointmentFixtures.length = 0;
  resourceFixtures.length = 0;
  activityEventFixtures.length = 0;
  notificationFixtures.length = 0;
  appointmentReminderFixtures.length = 0;
  calendarFeedTokenFixtures.length = 0;
});
afterEach(() => {
  appointmentFixtures.length = 0;
  resourceFixtures.length = 0;
  activityEventFixtures.length = 0;
  notificationFixtures.length = 0;
  appointmentReminderFixtures.length = 0;
  calendarFeedTokenFixtures.length = 0;
});

describe('GET /api/calendar-feed/[token]', () => {
  it('returns 404 for a nonexistent token', async () => {
    expect((await feedRequest('not-a-real-token')).status).toBe(404);
  });

  it('returns 404 for a revoked token', async () => {
    const { token, rawToken } = await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    await revokeFeedToken(DEFAULT_ORGANIZATION_ID, token.id, 'mock');
    expect((await feedRequest(rawToken)).status).toBe(404);
  });

  it("returns only the token owner's own, non-draft appointments as a valid ICS feed, and touches lastAccessedAt", async () => {
    const { token, rawToken } = await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    const chapel = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');

    const owned = await createAppointment(
      {
        appointmentType: 'viewing',
        title: 'Dana Viewing',
        ownerStaffProfileId: 'staff-dana',
        resourceIds: [chapel.id],
        startAt: '2026-09-10T14:00:00.000Z',
        endAt: '2026-09-10T15:00:00.000Z',
        timezone: 'America/New_York',
        saveAsDraft: false,
        idFactory,
      },
      SEED_CTX,
      'mock',
    );
    await createAppointment(
      {
        appointmentType: 'viewing',
        title: 'Chris Viewing',
        ownerStaffProfileId: 'staff-chris',
        resourceIds: [chapel.id],
        startAt: '2026-09-11T14:00:00.000Z',
        endAt: '2026-09-11T15:00:00.000Z',
        timezone: 'America/New_York',
        saveAsDraft: false,
        idFactory,
      },
      SEED_CTX,
      'mock',
    );
    await createAppointment(
      { appointmentType: 'viewing', title: 'Dana Draft', ownerStaffProfileId: 'staff-dana', startAt: '2026-09-12T14:00:00.000Z', endAt: '2026-09-12T15:00:00.000Z', timezone: 'America/New_York', saveAsDraft: true, idFactory },
      SEED_CTX,
      'mock',
    );

    const response = await feedRequest(rawToken);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/calendar');

    const body = await response.text();
    expect(body).toContain(`UID:beacon-appointment-${owned.id}@beacon.app`);
    expect(body).not.toContain('Chris Viewing');
    expect(body).not.toContain('Dana Draft');

    const persisted = calendarFeedTokenFixtures.find((t) => t.id === token.id)!;
    expect(persisted.lastAccessedAt).not.toBeNull();
  });
});
