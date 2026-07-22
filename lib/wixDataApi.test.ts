import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryWixDataItems } from './wixDataApi';

const ENV_KEYS = ['WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.WIX_API_KEY = 'test-key-value';
  process.env.WIX_SITE_ID = 'test-site-id';
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  vi.unstubAllGlobals();
});

describe('queryWixDataItems', () => {
  it('sends the correct method, headers, and body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dataItems: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await queryWixDataItems('organizations', { filter: { beaconOrganizationId: 'managed-cremations' }, paging: { limit: 1 } });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.wixapis.com/wix-data/v2/items/query',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'test-key-value',
          'wix-site-id': 'test-site-id',
        },
        body: JSON.stringify({
          dataCollectionId: 'organizations',
          query: { filter: { beaconOrganizationId: 'managed-cremations' }, paging: { limit: 1 } },
        }),
      }),
    );
  });

  it('throws a clean error, naming the collection and status, on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }),
    );

    await expect(queryWixDataItems('organizations', {})).rejects.toThrow(/organizations.*403/);
  });

  it('never includes the raw API key value in a thrown error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(queryWixDataItems('organizations', {})).rejects.not.toThrow(/test-key-value/);
  });
});
