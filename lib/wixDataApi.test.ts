import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  queryWixDataItems,
  queryAllWixDataItems,
  insertWixDataItem,
  updateWixDataItem,
  deleteWixDataItem,
  incrementWixDataField,
  conditionalPatchWixDataItem,
  WixDataApiError,
} from './wixDataApi';

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

describe('queryAllWixDataItems — Manors go-live incident fix (2026-09)', () => {
  function page(items: unknown[], hasNext: boolean, next?: string) {
    return { ok: true, json: async () => ({ dataItems: items, pagingMetadata: { hasNext, cursors: { next: next ?? null } } }) };
  }

  it('returns every item from a single page unchanged (hasNext: false)', async () => {
    const items = [{ id: '1', dataCollectionId: 'rolePermissions', data: { permissionKey: 'case.read' } }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(page(items, false)));

    const result = await queryAllWixDataItems('rolePermissions', { roleId: 'role-x' });
    expect(result).toEqual(items);
  });

  it('aggregates across multiple pages, following the cursor until hasNext is false — this is the exact bug fixed: a role with more than 50 grants (e.g. 68) is now read completely, not silently capped at the first page', async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => ({ id: `p1-${i}`, dataCollectionId: 'rolePermissions', data: { seq: i } }));
    const page2Items = Array.from({ length: 18 }, (_, i) => ({ id: `p2-${i}`, dataCollectionId: 'rolePermissions', data: { seq: 50 + i } }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(page1Items, true, 'cursor-abc'))
      .mockResolvedValueOnce(page(page2Items, false));
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryAllWixDataItems('rolePermissions', { roleId: 'role-administrator' });

    expect(result).toHaveLength(68);
    expect(result.map((r) => r.id)).toContain('p2-17'); // the very last item on "page 2" — proof it isn't dropped
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requests the first page via paging.limit alone, and every subsequent page via paging.cursor alone (never both together, per Wix Data\'s own contract)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: '1', dataCollectionId: 'x', data: {} }], true, 'cursor-1'))
      .mockResolvedValueOnce(page([{ id: '2', dataCollectionId: 'x', data: {} }], false));
    vi.stubGlobal('fetch', fetchMock);

    await queryAllWixDataItems('rolePermissions', { roleId: 'role-x' }, { limit: 100 });

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.query.paging).toEqual({ limit: 100 });
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.query.paging).toEqual({ cursor: 'cursor-1' });
  });

  it('passes the filter through on every page, not just the first', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: '1', dataCollectionId: 'x', data: {} }], true, 'cursor-1'))
      .mockResolvedValueOnce(page([{ id: '2', dataCollectionId: 'x', data: {} }], false));
    vi.stubGlobal('fetch', fetchMock);

    await queryAllWixDataItems('rolePermissions', { roleId: 'role-administrator' });

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.query.filter).toEqual({ roleId: 'role-administrator' });
    expect(secondBody.query.filter).toEqual({ roleId: 'role-administrator' });
  });

  it('defaults to a 100-item page size when no limit is given', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page([], false));
    vi.stubGlobal('fetch', fetchMock);

    await queryAllWixDataItems('rolePermissions', { roleId: 'role-x' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query.paging).toEqual({ limit: 100 });
  });

  it('stops if hasNext is true but no cursor is actually returned, rather than looping forever', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page([{ id: '1', dataCollectionId: 'x', data: {} }], true, undefined));
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryAllWixDataItems('rolePermissions', { roleId: 'role-x' });
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws rather than looping unbounded if hasNext never becomes false', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => page([{ id: 'x', dataCollectionId: 'x', data: {} }], true, 'always-more'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(queryAllWixDataItems('rolePermissions', { roleId: 'role-x' })).rejects.toThrow(/did not terminate/);
  });

  it('treats a missing pagingMetadata (older/mocked response shape) as a single, complete page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ dataItems: [{ id: '1', dataCollectionId: 'x', data: {} }] }) }));

    const result = await queryAllWixDataItems('rolePermissions', { roleId: 'role-x' });
    expect(result).toHaveLength(1);
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

describe('incrementWixDataField', () => {
  it('PATCHes the item with an INCREMENT_FIELD modification', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dataItem: { id: 'managed-cremations-2026', dataCollectionId: 'caseSequences', data: { nextSequence: 2 } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await incrementWixDataField('caseSequences', 'managed-cremations-2026', 'nextSequence', 1);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.wixapis.com/wix-data/v2/items/managed-cremations-2026',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          dataCollectionId: 'caseSequences',
          patch: {
            dataItemId: 'managed-cremations-2026',
            fieldModifications: [{ fieldPath: 'nextSequence', action: 'INCREMENT_FIELD', incrementFieldOptions: { value: 1 } }],
          },
        }),
      }),
    );
    expect(result.data.nextSequence).toBe(2);
  });

  it('throws a WixDataApiError carrying the real HTTP status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));

    await expect(incrementWixDataField('caseSequences', 'no-such-row', 'nextSequence', 1)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('conditionalPatchWixDataItem', () => {
  it('PATCHes the item with a SET_FIELD modification and the given condition', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dataItem: { id: 'sub-1', dataCollectionId: 'externalFormSubmissions', data: { createdCaseId: 'CLAIMING:token-1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await conditionalPatchWixDataItem(
      'externalFormSubmissions',
      'sub-1',
      'createdCaseId',
      'CLAIMING:token-1',
      { filter: { createdCaseId: { $eq: null } } },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.wixapis.com/wix-data/v2/items/sub-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          dataCollectionId: 'externalFormSubmissions',
          patch: {
            dataItemId: 'sub-1',
            fieldModifications: [{ fieldPath: 'createdCaseId', action: 'SET_FIELD', setFieldOptions: { value: 'CLAIMING:token-1' } }],
          },
          condition: { filter: { createdCaseId: { $eq: null } } },
        }),
      }),
    );
    expect(result).toEqual({ applied: true, dataItem: { id: 'sub-1', dataCollectionId: 'externalFormSubmissions', data: { createdCaseId: 'CLAIMING:token-1' } } });
  });

  it('returns {applied: false} — never throws — when the condition is not met', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) }));

    const result = await conditionalPatchWixDataItem('externalFormSubmissions', 'sub-1', 'createdCaseId', 'x', { filter: {} });
    expect(result).toEqual({ applied: false });
  });

  it('returns {applied: false} for any non-ok response, not just a specific status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    const result = await conditionalPatchWixDataItem('externalFormSubmissions', 'sub-1', 'createdCaseId', 'x', { filter: {} });
    expect(result).toEqual({ applied: false });
  });
});

describe('WixDataApiError — status is attached across every function, additive to the existing message', () => {
  it('queryWixDataItems / insertWixDataItem / updateWixDataItem / deleteWixDataItem all throw a WixDataApiError with the real status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) }));

    await expect(queryWixDataItems('cases', {})).rejects.toBeInstanceOf(WixDataApiError);
    await expect(insertWixDataItem('cases', {})).rejects.toMatchObject({ status: 409 });
    await expect(updateWixDataItem('cases', 'x', {})).rejects.toMatchObject({ status: 409 });
    await expect(deleteWixDataItem('cases', 'x')).rejects.toMatchObject({ status: 409 });
  });
});
