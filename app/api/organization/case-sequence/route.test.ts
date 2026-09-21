import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

let mockQueryWixDataItems = vi.fn();
let mockInsertWixDataItem = vi.fn();
let mockUpdateWixDataItem = vi.fn();
vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  class WixDataApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    WixDataApiError,
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    // Manors go-live pagination fix (2026-09): see the identical comment
    // in app/api/cases/route.test.ts.
    queryAllWixDataItems: async (collectionId: string, filter?: Record<string, unknown>) => {
      getWixServerConfig();
      const response = await mockQueryWixDataItems(collectionId, { filter });
      return response.dataItems;
    },
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
    updateWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockUpdateWixDataItem(...args);
    },
    incrementWixDataField: vi.fn(),
  };
});

const { GET, POST } = await import('./route');

function getRequest(organizationId: string | null, year: string | number | null) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  if (year !== null) params.set('year', String(year));
  return GET(new Request(`http://localhost/api/organization/case-sequence?${params.toString()}`));
}

const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function postRequest(body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return POST(new Request('http://localhost/api/organization/case-sequence', { method: 'POST', headers, body: JSON.stringify(body) }));
}

/** Seeds mockQueryWixDataItems to answer the 'administrator' role's
    'roles'/'rolePermissions' lookups with `organization.manage` granted
    — needed only for wix-mode tests, since mock mode resolves permissions
    from plain fixtures without touching queryWixDataItems at all. */
function seedAdministratorOrganizationManage() {
  mockQueryWixDataItems.mockImplementation((collectionId: string) => {
    if (collectionId === 'roles') {
      return Promise.resolve({
        dataItems: [
          { id: 'role-administrator', dataCollectionId: 'roles', data: { beaconRoleId: 'role-administrator', key: 'administrator', name: 'Administrator', description: 'Full access.', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } },
        ],
      });
    }
    if (collectionId === 'rolePermissions') {
      return Promise.resolve({
        dataItems: [
          { id: 'rp-org-manage', dataCollectionId: 'rolePermissions', data: { beaconRolePermissionId: 'rp-org-manage', roleId: 'role-administrator', permissionKey: 'organization.manage', createdAt: '2026-01-01T00:00:00.000Z' } },
        ],
      });
    }
    return Promise.resolve({ dataItems: [] });
  });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  mockQueryWixDataItems = vi.fn().mockResolvedValue({ dataItems: [] });
  mockInsertWixDataItem = vi.fn();
  mockUpdateWixDataItem = vi.fn();
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
});

describe('GET /api/organization/case-sequence — authorization', () => {
  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, 2026)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID, 2026)).status).toBe(403);
  });

  it('returns 400 when organizationId or year is missing/malformed', async () => {
    expect((await getRequest(null, 2026)).status).toBe(400);
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, 'not-a-year')).status).toBe(400);
  });

  it('returns 403 for a caller without organization.manage (mock mode, no Wix calls needed)', async () => {
    mockSession = { user: mockMultiOrgUser }; // officeStaff on DEFAULT_ORGANIZATION_ID
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, 2026)).status).toBe(403);
  });

  it('returns 400 outside DATA_ADAPTER=wix, even for an administrator', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, 2026)).status).toBe(400);
  });
});

describe('GET /api/organization/case-sequence — wix mode', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('returns nextSequence: null when no row exists for this organization+year yet', async () => {
    seedAdministratorOrganizationManage();
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, 2027);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nextSequence).toBeNull();
  });

  it('returns the current nextSequence when a row exists', async () => {
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'roles') {
        return Promise.resolve({ dataItems: [{ id: 'role-administrator', dataCollectionId: 'roles', data: { beaconRoleId: 'role-administrator', key: 'administrator', name: 'Administrator', description: 'x', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }] });
      }
      if (collectionId === 'rolePermissions') {
        return Promise.resolve({ dataItems: [{ id: 'rp', dataCollectionId: 'rolePermissions', data: { beaconRolePermissionId: 'rp', roleId: 'role-administrator', permissionKey: 'organization.manage', createdAt: '2026-01-01T00:00:00.000Z' } }] });
      }
      if (collectionId === 'caseSequences') {
        return Promise.resolve({ dataItems: [{ id: `${DEFAULT_ORGANIZATION_ID}-2026`, dataCollectionId: 'caseSequences', data: { organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 } }] });
      }
      return Promise.resolve({ dataItems: [] });
    });

    const response = await getRequest(DEFAULT_ORGANIZATION_ID, 2026);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nextSequence).toBe(185);
  });
});

describe('POST /api/organization/case-sequence — authorization and validation', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 },
      { origin: 'https://evil.example.com', host: 'localhost', 'Content-Type': 'application/json' },
    );
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 });
    expect(response.status).toBe(401);
  });

  it.each([
    [{ year: 2026, nextSequence: 185 }], // missing organizationId
    [{ organizationId: DEFAULT_ORGANIZATION_ID, year: 'not-a-year', nextSequence: 185 }],
    [{ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 0 }],
    [{ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: -5 }],
    [{ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 1.5 }],
    [{ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185, forceOverwrite: 'yes' }],
  ])('returns 400 for an invalid body (%o)', async (body) => {
    expect((await postRequest(body)).status).toBe(400);
  });

  it('returns 403 for a caller without organization.manage (mock mode)', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 });
    expect(response.status).toBe(403);
  });

  it('returns 400 outside DATA_ADAPTER=wix, even for an administrator', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/organization/case-sequence — wix mode', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    seedAdministratorOrganizationManage();
  });

  it('initializes a fresh sequence when none exists yet', async () => {
    mockInsertWixDataItem.mockResolvedValue({ id: `${DEFAULT_ORGANIZATION_ID}-2026`, dataCollectionId: 'caseSequences', data: { organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 } });

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nextSequence).toBe(185);
    expect(mockInsertWixDataItem).toHaveBeenCalledWith('caseSequences', { organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 }, `${DEFAULT_ORGANIZATION_ID}-2026`);
  });

  it('returns 409 with the current value when already initialized and forceOverwrite is not set', async () => {
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    mockInsertWixDataItem.mockRejectedValue(new WixDataApiError('conflict', 409));
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [{ id: 'role-administrator', dataCollectionId: 'roles', data: { beaconRoleId: 'role-administrator', key: 'administrator', name: 'x', description: 'x', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: [{ id: 'rp', dataCollectionId: 'rolePermissions', data: { beaconRolePermissionId: 'rp', roleId: 'role-administrator', permissionKey: 'organization.manage', createdAt: '2026-01-01T00:00:00.000Z' } }] });
      if (collectionId === 'caseSequences') return Promise.resolve({ dataItems: [{ id: `${DEFAULT_ORGANIZATION_ID}-2026`, dataCollectionId: 'caseSequences', data: { organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 17 } }] });
      return Promise.resolve({ dataItems: [] });
    });

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 185 });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.currentNextSequence).toBe(17);
  });

  it('refuses forceOverwrite when it would move the sequence backwards', async () => {
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    mockInsertWixDataItem.mockRejectedValue(new WixDataApiError('conflict', 409));
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [{ id: 'role-administrator', dataCollectionId: 'roles', data: { beaconRoleId: 'role-administrator', key: 'administrator', name: 'x', description: 'x', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: [{ id: 'rp', dataCollectionId: 'rolePermissions', data: { beaconRolePermissionId: 'rp', roleId: 'role-administrator', permissionKey: 'organization.manage', createdAt: '2026-01-01T00:00:00.000Z' } }] });
      if (collectionId === 'caseSequences') return Promise.resolve({ dataItems: [{ id: `${DEFAULT_ORGANIZATION_ID}-2026`, dataCollectionId: 'caseSequences', data: { organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 188 } }] });
      return Promise.resolve({ dataItems: [] });
    });

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 5, forceOverwrite: true });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/backwards/);
  });
});
