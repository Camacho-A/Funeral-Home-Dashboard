import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockOrganizationFixtures } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
const { canManageOrganization } = vi.hoisted(() => ({ canManageOrganization: vi.fn(async () => true) }));
vi.mock('@/services/authorizationPolicyService', async () => {
  const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
  return { ...actual, canManageOrganization };
});

const { GET, PATCH } = await import('./route');

const orgIndex = mockOrganizationFixtures.findIndex((o) => o.id === DEFAULT_ORGANIZATION_ID);
const original = mockOrganizationFixtures[orgIndex];
afterEach(() => {
  mockOrganizationFixtures[orgIndex] = original;
  vi.clearAllMocks();
  mockSession = { user: mockDefaultUser };
});

const get = () => GET(new Request(`http://localhost/api/organization/sla-settings?organizationId=${DEFAULT_ORGANIZATION_ID}`));
const patch = (settings: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) =>
  PATCH(new Request('http://localhost/api/organization/sla-settings', { method: 'PATCH', headers, body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, settings }) }));

describe('/api/organization/sla-settings', () => {
  it('returns the defaults until an administrator changes them', async () => {
    const body = await (await get()).json();
    expect(body.settings).toMatchObject({ enabled: true, timezone: 'America/New_York', targets: { edrsEntry: 2, doctorAttestation: 4, hardSave: 0, approval: 2, crematoryTurnaround: 5, familyPickup: 5 } });
  });

  it('saves validated settings; invalid values fall back to their defaults', async () => {
    const response = await patch({ targets: { approval: 3, crematoryTurnaround: -4 }, holidays: ['11/26/2026', 'not a date'], crematoryReturnWeekdays: [2, 5, 9], afterHoursCutoff: '16:30', enabled: false });
    const body = await response.json();
    expect(body.settings).toMatchObject({ enabled: true, afterHoursCutoff: '16:30', holidays: ['2026-11-26'], crematoryReturnWeekdays: [2, 5] });
    expect(body.settings.targets).toMatchObject({ approval: 3, crematoryTurnaround: 5 });
    expect((await (await get()).json()).settings.targets.approval).toBe(3);
    expect(mockOrganizationFixtures[orgIndex].slaSettings).not.toHaveProperty('enabled');
  });

  it('is for administrators only, and same-site only', async () => {
    canManageOrganization.mockResolvedValue(false);
    expect((await get()).status).toBe(403);
    expect((await patch({})).status).toBe(403);
    canManageOrganization.mockResolvedValue(true);
    expect((await patch({}, { origin: 'https://evil.example', host: 'localhost' })).status).toBe(403);
  });
});
