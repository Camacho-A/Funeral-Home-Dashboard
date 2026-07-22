import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { GET } = await import('./route');

function paramsFor(organizationId: string) {
  return { params: Promise.resolve({ organizationId }) };
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('GET /api/organizations/[organizationId] — mock mode', () => {
  it('returns the fixture organization for a known id', async () => {
    const response = await GET(new Request('http://localhost/api/organizations/managed-cremations'), paramsFor('managed-cremations'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organization).toEqual({ id: 'managed-cremations', name: "Manor's Cremation", isActive: true });
  });

  it('returns 404 for an unknown organization id, never attempting a Wix call', async () => {
    const response = await GET(new Request('http://localhost/api/organizations/no-such-org'), paramsFor('no-such-org'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.organization).toBeNull();
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
