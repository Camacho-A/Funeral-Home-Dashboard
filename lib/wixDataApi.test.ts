import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, deleteWixDataItem } from './wixDataApi';

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

describe('insertWixDataItem', () => {
  it('POSTs with the correct headers and body shape, including a custom item id when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dataItem: { id: 'case-1', dataCollectionId: 'cases', data: { beaconCaseId: 'case-1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await insertWixDataItem('cases', { beaconCaseId: 'case-1' }, 'case-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.wixapis.com/wix-data/v2/items',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'test-key-value', 'wix-site-id': 'test-site-id' },
        body: JSON.stringify({ dataCollectionId: 'cases', dataItem: { id: 'case-1', data: { beaconCaseId: 'case-1' } } }),
      }),
    );
    expect(result.id).toBe('case-1');
  });

  it('omits the id field when no custom item id is given, letting Wix auto-generate one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dataItem: { id: 'auto-generated', dataCollectionId: 'tasks', data: {} } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await insertWixDataItem('tasks', { text: 'hi' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ dataCollectionId: 'tasks', dataItem: { data: { text: 'hi' } } }) }),
    );
  });

  it('throws a clean error naming the collection and status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    await expect(insertWixDataItem('cases', {})).rejects.toThrow(/cases.*400/);
  });
});

describe('updateWixDataItem', () => {
  it('PUTs to the item-scoped URL with the full data object', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dataItem: { id: 'case-1', dataCollectionId: 'cases', data: { decedentName: 'Updated' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await updateWixDataItem('cases', 'case-1', { decedentName: 'Updated' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.wixapis.com/wix-data/v2/items/case-1?dataCollectionId=cases',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ dataItem: { id: 'case-1', data: { decedentName: 'Updated' } } }),
      }),
    );
  });

  it('throws a clean error naming the collection and status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await expect(updateWixDataItem('cases', 'no-such-id', {})).rejects.toThrow(/cases.*404/);
  });
});

describe('deleteWixDataItem', () => {
  it('DELETEs to the item-scoped URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await deleteWixDataItem('tasks', 'task-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.wixapis.com/wix-data/v2/items/task-1?dataCollectionId=tasks',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws a clean error naming the collection and status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(deleteWixDataItem('tasks', 'task-1')).rejects.toThrow(/tasks.*500/);
  });
});
