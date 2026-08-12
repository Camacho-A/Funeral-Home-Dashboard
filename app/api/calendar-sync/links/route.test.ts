import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { calendarEventLinkFixtures } from '@/services/__mocks__/calendarFixtures';
import type { CalendarEventLink } from '@/types/calendarEventLink';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET } = await import('./route');

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/calendar-sync/links?${params.toString()}`));
}

function seedLink(overrides: Partial<CalendarEventLink> = {}): CalendarEventLink {
  const link: CalendarEventLink = {
    id: 'link-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    appointmentId: 'appt-1',
    calendarConnectionId: 'conn-1',
    provider: 'google',
    externalCalendarId: 'primary',
    externalEventId: null,
    syncStatus: 'synced',
    beaconAppointmentVersion: 1,
    lastSyncedAt: null,
    lastError: null,
    retryCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  calendarEventLinkFixtures.push(link);
  return link;
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  calendarEventLinkFixtures.length = 0;
});
afterEach(() => {
  calendarEventLinkFixtures.length = 0;
});

describe('GET /api/calendar-sync/links', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest({})).status).toBe(400);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID })).status).toBe(403);
  });

  it('returns only links scoped to this organization', async () => {
    seedLink({ id: 'link-mine' });
    seedLink({ id: 'link-other', organizationId: SECOND_MOCK_ORGANIZATION_ID });

    const response = await getRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.links.map((l: CalendarEventLink) => l.id)).toEqual(['link-mine']);
  });
});
