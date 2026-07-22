import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockDefaultUser,
  mockMultiOrgUser,
  mockInactiveMembershipUser,
} from '../../services/__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };

// Mocked for the same reason app/api/*/route.test.ts files mock it: getSession()
// depends on next/headers's cookies(), which isn't available outside a real
// request context. resolveAuthorizationContext (the actual authorization
// decision) is left completely real, run against the real mock membership
// fixtures — only "read the session cookie" is faked.
vi.mock('./session', () => ({
  getSession: async () => mockSession,
}));

const { requireAuthorizedOrganization } = await import('./requireAuthorizedOrganization');

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
});

describe('requireAuthorizedOrganization — authorized access', () => {
  it('grants access and returns a trusted context when the session has an active membership in the requested organization', async () => {
    const result = await requireAuthorizedOrganization(DEFAULT_ORGANIZATION_ID);

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.context).toEqual({
        userId: mockDefaultUser.id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        role: 'administrator',
      });
    }
  });

  it("a user with two memberships is granted access to whichever one is explicitly requested, never both at once", async () => {
    mockSession = { user: mockMultiOrgUser };

    const first = await requireAuthorizedOrganization(DEFAULT_ORGANIZATION_ID);
    const second = await requireAuthorizedOrganization(SECOND_MOCK_ORGANIZATION_ID);

    expect(first.authorized).toBe(true);
    expect(second.authorized).toBe(true);
    if (first.authorized) expect(first.context.role).toBe('staff');
    if (second.authorized) expect(second.context.role).toBe('caseManager');
  });
});

describe('requireAuthorizedOrganization — unauthenticated access', () => {
  it('returns a 401 response when there is no session at all', async () => {
    mockSession = null;
    const result = await requireAuthorizedOrganization(DEFAULT_ORGANIZATION_ID);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.error).toBeTruthy();
    }
  });
});

describe('requireAuthorizedOrganization — forged organizationId', () => {
  it("rejects a requested organizationId the session's user has no membership in at all", async () => {
    const result = await requireAuthorizedOrganization(SECOND_MOCK_ORGANIZATION_ID);

    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('rejects a plausible-looking but entirely fabricated organizationId', async () => {
    const result = await requireAuthorizedOrganization('some-other-real-looking-org-id');

    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });
});

describe('requireAuthorizedOrganization — missing/invalid membership', () => {
  it('rejects a user whose only membership row is inactive', async () => {
    mockSession = { user: mockInactiveMembershipUser };
    const result = await requireAuthorizedOrganization(DEFAULT_ORGANIZATION_ID);

    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('rejects a user with zero membership rows', async () => {
    mockSession = {
      user: { id: 'mock-user-nobody', email: 'nobody@beacon.test', displayName: 'Nobody', source: 'mock' },
    };
    const result = await requireAuthorizedOrganization(DEFAULT_ORGANIZATION_ID);

    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });
});

describe('requireAuthorizedOrganization — standardized failures do not leak information', () => {
  it('every denial reason (no membership, wrong org, fabricated org, inactive membership) produces the identical response body', async () => {
    const noMembership = await requireAuthorizedOrganization(SECOND_MOCK_ORGANIZATION_ID);
    const fabricated = await requireAuthorizedOrganization('some-other-real-looking-org-id');

    mockSession = { user: mockInactiveMembershipUser };
    const inactive = await requireAuthorizedOrganization(DEFAULT_ORGANIZATION_ID);

    expect(noMembership.authorized).toBe(false);
    expect(fabricated.authorized).toBe(false);
    expect(inactive.authorized).toBe(false);
    if (!noMembership.authorized && !fabricated.authorized && !inactive.authorized) {
      const bodies = await Promise.all(
        [noMembership.response, fabricated.response, inactive.response].map((r) => r.json()),
      );
      expect(bodies[0]).toEqual(bodies[1]);
      expect(bodies[1]).toEqual(bodies[2]);
      expect(noMembership.response.status).toBe(fabricated.response.status);
      expect(fabricated.response.status).toBe(inactive.response.status);
    }
  });

  it('the unauthorized response never mentions a reason, membership, or organization name', async () => {
    const result = await requireAuthorizedOrganization(SECOND_MOCK_ORGANIZATION_ID);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      const bodyText = await result.response.clone().text();
      expect(bodyText.toLowerCase()).not.toMatch(/membership|no_active|organization_mismatch|selection_required|evergreen/);
    }
  });
});
