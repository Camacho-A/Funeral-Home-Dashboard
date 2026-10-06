import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import type { Case } from '@/types/case';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockCountWixDataItems = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    queryAllWixDataItems: async (collectionId: string, filter?: Record<string, unknown>) => {
      getWixServerConfig();
      const response = await mockQueryWixDataItems(collectionId, { filter });
      return response.dataItems;
    },
    countWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockCountWixDataItems(...args);
    },
  };
});

const ADMINISTRATOR_ROLE_ITEM = {
  id: 'role-administrator',
  dataCollectionId: 'roles',
  data: {
    beaconRoleId: 'role-administrator',
    key: 'administrator',
    name: 'Administrator',
    description: 'Full access.',
    organizationId: null,
    isSystemDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};
const ADMINISTRATOR_ROLE_PERMISSION_ITEMS = ['case.read'].map((permissionKey) => ({
  id: `role-permission-administrator-${permissionKey}`,
  dataCollectionId: 'rolePermissions',
  data: {
    beaconRolePermissionId: `role-permission-administrator-${permissionKey}`,
    roleId: 'role-administrator',
    permissionKey,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
}));

function mockRolesAndCounts(countsByFilter: (filter: Record<string, unknown>) => number) {
  mockQueryWixDataItems.mockImplementation((collectionId: string) => {
    if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
    if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
    return Promise.resolve({ dataItems: [] });
  });
  mockCountWixDataItems.mockImplementation((_collectionId: string, filter: Record<string, unknown>) => Promise.resolve(countsByFilter(filter)));
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function requestFor(organizationId: string | null, params: Record<string, string> = {}) {
  const search = new URLSearchParams(params);
  if (organizationId) search.set('organizationId', organizationId);
  return new Request(`http://localhost/api/cases/counts?${search.toString()}`);
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
  mockCountWixDataItems = vi.fn();
  mockSession = { user: mockDefaultUser };
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('GET /api/cases/counts — request validation', () => {
  it('returns 400 when organizationId is missing', async () => {
    const response = await GET(requestFor(null));
    expect(response.status).toBe(400);
  });
});

describe('GET /api/cases/counts — authorization', () => {
  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    expect(response.status).toBe(401);
  });

  it('returns 403 for a forged organizationId the session has no membership in', async () => {
    const response = await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID));
    const body = await response.json();
    expect(response.status).toBe(403);
    // requireAuthorizedOrganization's own generic 403 response is returned
    // verbatim here — this route's { total, byStage } shape only appears
    // once it reaches its own authorization/try block, same convention as
    // GET /api/cases's identical 403 test.
    expect(body.cases).toBeUndefined();
    expect(mockCountWixDataItems).not.toHaveBeenCalled();
  });
});

/**
 * Case list scalability, Phase 2 (2026-09). Mock mode.
 */
describe('GET /api/cases/counts — mock mode', () => {
  const pushedIds: string[] = [];

  function pushMockCase(id: string, overrides: Partial<Case> & { caseNumber: string; createdAt: string }) {
    const template = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
    caseFixtures.push({
      ...template,
      ...overrides,
      id,
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
      isDeleted: overrides.isDeleted ?? false,
    });
    pushedIds.push(id);
  }

  beforeEach(() => {
    mockSession = { user: mockMultiOrgUser };
  });

  afterEach(() => {
    while (pushedIds.length > 0) {
      const id = pushedIds.pop()!;
      const index = caseFixtures.findIndex((c) => c.id === id);
      if (index !== -1) caseFixtures.splice(index, 1);
    }
  });

  it('1/2. All Cases total and every canonical STAGES entry receive the correct count', async () => {
    pushMockCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 0 });
    pushMockCase('b', { caseNumber: 'B2026-102', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 1 });
    pushMockCase('c', { caseNumber: 'B2026-103', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
    pushMockCase('d', { caseNumber: 'B2026-104', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });

    const body = await (await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID))).json();

    expect(body.total).toBe(4);
    expect(body.byStage['First Call & Payment']).toBe(2);
    expect(body.byStage['Jotform Application']).toBe(0);
    expect(body.byStage['EDRS & Doctor / Cause of Death']).toBe(0);
    expect(body.byStage['Permit & Authorization Sent to Crematory']).toBe(0);
    expect(body.byStage['DC Application Sent']).toBe(0);
    expect(body.byStage['Ready for Pickup / Contact Family']).toBe(0);
    expect(body.byStage['Completed']).toBe(2);
  });

  it('3. counts exclude deleted cases', async () => {
    pushMockCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
    pushMockCase('a-deleted', { caseNumber: 'B2026-102', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7, isDeleted: true });

    const body = await (await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID))).json();
    expect(body.total).toBe(1);
    expect(body.byStage['Completed']).toBe(1);
  });

  it('4/5. counts are organization-scoped — another organization\'s cases never affect them', async () => {
    pushMockCase('other-org', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
    const body = await (await GET(requestFor(DEFAULT_ORGANIZATION_ID))).json();
    expect(body.byStage['Completed']).not.toBeGreaterThanOrEqual(1000); // sanity: not somehow inflated
    // The pushed fixture belongs to SECOND_MOCK_ORGANIZATION_ID, never DEFAULT_ORGANIZATION_ID's own counts.
    const defaultOrgCaseCount = caseFixtures.filter((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted).length;
    expect(body.total).toBe(defaultOrgCaseCount);
  });

  it('6. empty organization returns zero counts', async () => {
    const body = await (await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID))).json();
    expect(body.total).toBe(0);
    Object.values(body.byStage).forEach((count) => expect(count).toBe(0));
  });

  it('7. search-aware counts: WITH a search query, every count reflects only matching cases', async () => {
    pushMockCase('match', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', rawStage: 7 });
    pushMockCase('no-match', { caseNumber: 'B2026-102', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'SMITH FAMILY', rawStage: 7 });

    const withoutSearch = await (await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID))).json();
    expect(withoutSearch.total).toBe(2);

    const withSearch = await (await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: 'morales' }))).json();
    expect(withSearch.total).toBe(1);
    expect(withSearch.byStage['Completed']).toBe(1);
  });

  it('8. counts agree with the corresponding list query (same filter, same result size)', async () => {
    pushMockCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
    pushMockCase('b', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', rawStage: 7 });

    const { GET: GET_LIST } = await import('../route');
    const listBody = await (
      await GET_LIST(
        new Request(
          `http://localhost/api/cases?${new URLSearchParams({ organizationId: SECOND_MOCK_ORGANIZATION_ID, stage: 'Completed', limit: '10' }).toString()}`,
        ),
      )
    ).json();
    const countsBody = await (await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID))).json();

    expect(countsBody.byStage['Completed']).toBe(listBody.cases.length);
  });
});

/**
 * Case list scalability, Phase 2 (2026-09). Wix mode — proves counts are
 * obtained via Wix Data's dedicated Count endpoint (no `dataItems`
 * transferred at all) and agree with the canonical stage/search filter
 * shape (`buildCaseListWixFilter`).
 */
describe('GET /api/cases/counts — wix mode', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('9. calls countWixDataItems — never queryWixDataItems/queryAllWixDataItems for cases — to avoid downloading any Case record', async () => {
    mockRolesAndCounts(() => 5);
    await GET(requestFor(DEFAULT_ORGANIZATION_ID));

    expect(mockCountWixDataItems).toHaveBeenCalled();
    const casesQueryCalls = mockQueryWixDataItems.mock.calls.filter((call) => call[0] === 'cases');
    expect(casesQueryCalls).toHaveLength(0);
  });

  it('1/2. issues one count call for the total and one per STAGES entry (8 total), each scoped correctly', async () => {
    mockRolesAndCounts((filter) => {
      if ('currentStage' in filter) return 3;
      return 21;
    });
    const body = await (await GET(requestFor(DEFAULT_ORGANIZATION_ID))).json();

    expect(body.total).toBe(21);
    expect(body.byStage['Completed']).toBe(3);
    expect(body.byStage['First Call & Payment']).toBe(3);
    expect(mockCountWixDataItems).toHaveBeenCalledTimes(8);
  });

  it('4/5. every count call is organization-scoped via the server-derived organizationId', async () => {
    mockRolesAndCounts((filter) => {
      expect(filter).toMatchObject({ organizationId: DEFAULT_ORGANIZATION_ID, isArchived: false });
      return 0;
    });
    await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    expect(mockCountWixDataItems).toHaveBeenCalled();
  });

  it('3. every count call excludes archived/deleted cases', async () => {
    mockRolesAndCounts((filter) => {
      expect(filter).toMatchObject({ isArchived: false });
      return 0;
    });
    await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    expect(mockCountWixDataItems).toHaveBeenCalled();
  });

  it('the currentStage $in for "First Call & Payment" is [0, 1]', async () => {
    let sawCombinedStage = false;
    mockRolesAndCounts((filter) => {
      if (JSON.stringify((filter as { currentStage?: { $in: number[] } }).currentStage?.$in) === JSON.stringify([0, 1])) {
        sawCombinedStage = true;
      }
      return 0;
    });
    await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    expect(sawCombinedStage).toBe(true);
  });

  it('7. search-aware counts push the same $contains filter into every count call', async () => {
    let sawSearchFilter = false;
    mockRolesAndCounts((filter) => {
      if (JSON.stringify(filter).includes('$contains')) sawSearchFilter = true;
      return 0;
    });
    await GET(requestFor(DEFAULT_ORGANIZATION_ID, { searchQuery: 'morales' }));
    expect(sawSearchFilter).toBe(true);
  });

  it('6. empty organization returns zero counts', async () => {
    mockRolesAndCounts(() => 0);
    const body = await (await GET(requestFor(DEFAULT_ORGANIZATION_ID))).json();
    expect(body.total).toBe(0);
    Object.values(body.byStage).forEach((count) => expect(count).toBe(0));
  });

  it('never leaks the API key in an error response', async () => {
    process.env.WIX_API_KEY = 'super-secret-counts-test-value';
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
      return Promise.resolve({ dataItems: [] });
    });
    mockCountWixDataItems.mockRejectedValue(new Error('Wix Data count failed for collection "cases" (HTTP 500).'));

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const bodyText = await response.text();
    expect(response.status).toBe(503);
    expect(bodyText).not.toContain('super-secret-counts-test-value');
  });
});
