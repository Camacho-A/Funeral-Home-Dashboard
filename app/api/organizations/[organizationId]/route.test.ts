import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();

// lib/wixDataApi.ts is mocked so these tests never make a real HTTP call —
// mockQueryWixDataItems's return value is set per test to simulate what the
// real Wix Data REST API would return, letting the route's own
// mapping/branching logic be what's under test. getWixServerConfig() (from
// lib/env.ts) is left unmocked and imported for real inside the mock
// factory, so the "missing config throws cleanly" behavior — the same
// validation the real queryWixDataItems() performs before ever calling
// fetch — is still genuinely exercised, not bypassed.
vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
  };
});

// Phase 15X (Multi-Tenant Authorization Hardening): lib/auth/session.ts's
// getSession() depends on next/headers's cookies(), which throws outside a
// real request context — mocked here so the route's real authorization
// logic (requireAuthorizedOrganization -> resolveAuthorizationContext) is
// still genuinely exercised against the real mock membership fixtures,
// only the "read the cookie" step is faked. Defaults to the standard
// single-org mock user (member of DEFAULT_ORGANIZATION_ID only); individual
// tests override mockSession to exercise the unauthenticated/unauthorized
// paths.
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function paramsFor(organizationId: string) {
  return { params: Promise.resolve({ organizationId }) };
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
  mockSession = { user: mockDefaultUser };
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('GET /api/organizations/[organizationId] — authorization', () => {
  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    const response = await GET(new Request('http://localhost/api/organizations/managed-cremations'), paramsFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBeTruthy();
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });

  it("returns 403 for a forged organizationId the session's user has no membership in — rejected before any data lookup", async () => {
    const response = await GET(
      new Request('http://localhost/api/organizations/evergreen-memorial-group'),
      paramsFor(SECOND_MOCK_ORGANIZATION_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBeTruthy();
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });

  it('the 403 response never reveals whether the requested organization actually exists', async () => {
    const realButUnauthorized = await GET(
      new Request('http://localhost/api/organizations/evergreen-memorial-group'),
      paramsFor(SECOND_MOCK_ORGANIZATION_ID),
    );
    const fabricated = await GET(
      new Request('http://localhost/api/organizations/not-a-real-org'),
      paramsFor('not-a-real-org'),
    );

    expect(realButUnauthorized.status).toBe(fabricated.status);
    expect(await realButUnauthorized.json()).toEqual(await fabricated.json());
  });
});

describe('GET /api/organizations/[organizationId] — mock mode', () => {
  it('returns the fixture organization for a known id', async () => {
    const response = await GET(new Request('http://localhost/api/organizations/managed-cremations'), paramsFor('managed-cremations'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organization).toEqual({ id: 'managed-cremations', name: "Manor's Cremation", isActive: true });
  });

  it('returns 403 (not 404) for an organizationId the caller has no membership in — the authorization layer rejects it before the fixture lookup is even attempted', async () => {
    const response = await GET(new Request('http://localhost/api/organizations/no-such-org'), paramsFor('no-such-org'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.organization).toBeUndefined();
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });
});

describe('GET /api/organizations/[organizationId] — wix mode', () => {
  it('fails cleanly with a clear message when required config is missing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    // WIX_API_KEY / WIX_SITE_ID deliberately left unset.

    const response = await GET(new Request('http://localhost/api/organizations/managed-cremations'), paramsFor('managed-cremations'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.organization).toBeNull();
    expect(body.error).toMatch(/WIX_API_KEY, WIX_SITE_ID/);
  });

  it('maps a real Wix query result to the Organization domain shape', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [
        {
          id: 'managed-cremations',
          dataCollectionId: 'organizations',
          data: { beaconOrganizationId: 'managed-cremations', name: "Manor's Cremation", isActive: true },
        },
      ],
    });

    const response = await GET(new Request('http://localhost/api/organizations/managed-cremations'), paramsFor('managed-cremations'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organization).toEqual({ id: 'managed-cremations', name: "Manor's Cremation", isActive: true });
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('organizations', {
      filter: { beaconOrganizationId: 'managed-cremations' },
      paging: { limit: 1 },
    });
  });

  it('returns 404 when Wix returns no matching item', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await GET(new Request('http://localhost/api/organizations/managed-cremations'), paramsFor('managed-cremations'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.organization).toBeNull();
  });

  it('never leaks a raw API key value into the response, even on failure', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'super-secret-test-value';
    // WIX_SITE_ID left unset, so getWixServerConfig() still throws before any
    // network call — this only proves the response body itself is clean.

    const response = await GET(new Request('http://localhost/api/organizations/managed-cremations'), paramsFor('managed-cremations'));
    const bodyText = await response.text();

    expect(bodyText).not.toContain('super-secret-test-value');
  });

  it('never exposes a raw Wix item shape (e.g. _id, _createdDate) in the response', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [
        {
          id: 'managed-cremations',
          dataCollectionId: 'organizations',
          data: {
            beaconOrganizationId: 'managed-cremations',
            name: "Manor's Cremation",
            isActive: true,
            _id: 'managed-cremations',
            _createdDate: '2026-07-22T00:49:39.414Z',
            _updatedDate: '2026-07-22T00:49:39.414Z',
          },
        },
      ],
    });

    const response = await GET(new Request('http://localhost/api/organizations/managed-cremations'), paramsFor('managed-cremations'));
    const body = await response.json();

    expect(Object.keys(body.organization)).toEqual(['id', 'name', 'isActive']);
  });
});
