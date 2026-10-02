import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/organizations/${organizationId}/branding`), { params: Promise.resolve({ organizationId }) });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});

/**
 * Manors branding/visibility follow-up (2026-10). Covers both the route's
 * own auth boundary and, directly, that the real logo asset placed in
 * this phase (public/brand/manors-logo.png) is actually connected —
 * `services/__mocks__/onboardingFixtures.ts#organizationBrandingFixtures`
 * now sets `logoUrl` to that path for Manors, and this is the one route
 * that surfaces it to the portal (Sidebar's own `useOrganizationBranding()`).
 */
describe('GET /api/organizations/[organizationId]/branding', () => {
  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId the caller has no membership in', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns the real connected Manors logo asset path', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branding.logoUrl).toBe('/brand/manors-logo.png');
  });
});
