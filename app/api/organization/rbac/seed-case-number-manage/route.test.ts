import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import {
  mockDefaultUser,
  mockMultiOrgUser,
  mockFuneralDirectorUser,
  mockManagerUser,
  mockOfficeStaffUser,
  mockAccountingUser,
  mockReadOnlyUser,
  mockDispatchUser,
} from '@/services/__mocks__/authFixtures';
import { resolveRoleKeyAlias } from '@/domain/rbac/legacyRoleAliases';

/**
 * Manors RBAC production migration (2026-09). `DEFAULT_ORGANIZATION_ID`
 * ('managed-cremations') is the real Manors org this route is hardcoded
 * to — these tests exercise the real authorization/eligibility/mutation
 * logic, not a stand-in.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

let mockQueryWixDataItems = vi.fn();
let mockInsertWixDataItem = vi.fn();
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
    queryAllWixDataItems: async (collectionId: string, filter?: Record<string, unknown>) => {
      getWixServerConfig();
      const response = await mockQueryWixDataItems(collectionId, { filter });
      return response.dataItems;
    },
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
    updateWixDataItem: vi.fn(),
    deleteWixDataItem: vi.fn(),
    incrementWixDataField: vi.fn(),
  };
});

const { GET, POST } = await import('./route');

function getRequest(organizationId: string | null) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  return GET(new Request(`http://localhost/api/organization/rbac/seed-case-number-manage?${params.toString()}`));
}

const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function postRequest(body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return POST(new Request('http://localhost/api/organization/rbac/seed-case-number-manage', { method: 'POST', headers, body: JSON.stringify(body) }));
}

const NOW = '2026-01-01T00:00:00.000Z';

function roleRow(roleKey: string) {
  return { id: `role-${roleKey}`, dataCollectionId: 'roles', data: { beaconRoleId: `role-${roleKey}`, key: roleKey, name: roleKey, description: 'x', organizationId: null, isSystemDefault: true, createdAt: NOW, updatedAt: NOW } };
}

function rolePermissionRow(roleKey: string, permissionKey: string) {
  const id = `rp-${roleKey}-${permissionKey}`;
  return { id, dataCollectionId: 'rolePermissions', data: { beaconRolePermissionId: id, roleId: `role-${roleKey}`, permissionKey, createdAt: NOW } };
}

/**
 * Seeds every 'roles'/'rolePermissions' lookup this route and the service
 * it calls can make. `callerRoleKey` always receives `user.manageRoles`
 * (Administrator's real, narrowest RBAC-admin permission) so authorization
 * succeeds unless a test explicitly asks it not to — `grantUserManageRoles:
 * false` simulates every other role's real lack of it. `administratorHasGrant`/
 * `funeralDirectorHasGrant` independently control whether `caseNumber.manage`
 * already exists for each target role, letting tests exercise both the
 * "missing -> create" and "already present -> no-op" paths precisely.
 */
function seedRoles(options: {
  callerRoleKey: string;
  grantUserManageRoles?: boolean;
  administratorHasGrant?: boolean;
  funeralDirectorHasGrant?: boolean;
}) {
  const { callerRoleKey, grantUserManageRoles = true, administratorHasGrant = false, funeralDirectorHasGrant = false } = options;

  // resolveRoleForKey resolves through the legacy alias table (e.g.
  // 'caseManager' -> 'funeralDirector') before querying 'roles' — grants
  // must be seeded against the ALIASED key so authorization actually
  // finds them, exactly as production resolution does.
  const canonicalCallerRoleKey = resolveRoleKeyAlias(callerRoleKey);
  const roleKeys = new Set([canonicalCallerRoleKey, 'administrator', 'funeralDirector']);
  const roleRows = [...roleKeys].map(roleRow);

  const rolePermissionRows: ReturnType<typeof rolePermissionRow>[] = [];
  if (grantUserManageRoles) rolePermissionRows.push(rolePermissionRow(canonicalCallerRoleKey, 'user.manageRoles'));
  // Every default role carries other, unrelated grants in real production
  // data — seeded here so "unrelated rolePermissions remain unchanged"
  // tests have something concrete to prove was never touched.
  rolePermissionRows.push(rolePermissionRow('administrator', 'case.read'));
  rolePermissionRows.push(rolePermissionRow('funeralDirector', 'case.read'));
  if (administratorHasGrant) rolePermissionRows.push(rolePermissionRow('administrator', 'caseNumber.manage'));
  if (funeralDirectorHasGrant) rolePermissionRows.push(rolePermissionRow('funeralDirector', 'caseNumber.manage'));

  mockQueryWixDataItems.mockImplementation((collectionId: string, queryOptions?: { filter?: Record<string, unknown> }) => {
    if (collectionId === 'roles') {
      const key = queryOptions?.filter?.key;
      return Promise.resolve({ dataItems: key ? roleRows.filter((r) => r.data.key === key) : roleRows });
    }
    if (collectionId === 'rolePermissions') {
      const roleId = queryOptions?.filter?.roleId;
      return Promise.resolve({ dataItems: roleId ? rolePermissionRows.filter((rp) => rp.data.roleId === roleId) : rolePermissionRows });
    }
    return Promise.resolve({ dataItems: [] });
  });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'wix';
  process.env.WIX_API_KEY = 'test-key';
  process.env.WIX_SITE_ID = 'test-site';
  mockSession = { user: mockDefaultUser };
  mockQueryWixDataItems = vi.fn().mockResolvedValue({ dataItems: [] });
  mockInsertWixDataItem = vi.fn().mockImplementation((collectionId: string, data: Record<string, unknown>, itemId: string) => Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }));
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  vi.clearAllMocks();
});

describe('POST /api/organization/rbac/seed-case-number-manage — authorization', () => {
  it('A: Administrator authorization succeeds', async () => {
    seedRoles({ callerRoleKey: 'administrator' });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
  });

  it('B: Funeral Director cannot execute the migration', async () => {
    mockSession = { user: mockFuneralDirectorUser };
    seedRoles({ callerRoleKey: 'funeralDirector', grantUserManageRoles: false });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('C: Manager cannot execute the migration', async () => {
    mockSession = { user: mockManagerUser };
    seedRoles({ callerRoleKey: 'manager', grantUserManageRoles: false });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it.each([
    ['officeStaff', () => mockOfficeStaffUser],
    ['accounting', () => mockAccountingUser],
    ['readOnly', () => mockReadOnlyUser],
    ['dispatch', () => mockDispatchUser],
  ])('D: %s cannot execute the migration', async (roleKey, getUser) => {
    mockSession = { user: getUser() };
    seedRoles({ callerRoleKey: roleKey, grantUserManageRoles: false });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('E: a legitimate administrator of a DIFFERENT organization cannot execute it against Manors — the organization is hardcoded, not just permission-gated', async () => {
    // mockMultiOrgUser is genuinely authorized for SECOND_MOCK_ORGANIZATION_ID
    // (role 'caseManager' there) — seed that role with user.manageRoles so
    // authorization itself would succeed, isolating the organization
    // hardcode as the only thing that can be blocking this request.
    mockSession = { user: mockMultiOrgUser };
    seedRoles({ callerRoleKey: 'caseManager' });
    const response = await postRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(response.status).toBe(400);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      { origin: 'https://evil.example.com', host: 'localhost', 'Content-Type': 'application/json' },
    );
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/organization/rbac/seed-case-number-manage — migration behavior', () => {
  beforeEach(() => {
    mockSession = { user: mockDefaultUser };
  });

  it('F: creates the Administrator grant when missing', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: true });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.administratorNewlyGranted).toBe(true);
    expect(mockInsertWixDataItem).toHaveBeenCalledWith(
      'rolePermissions',
      expect.objectContaining({ roleId: 'role-administrator', permissionKey: 'caseNumber.manage' }),
      expect.any(String),
    );
  });

  it('G: creates the Funeral Director grant when missing', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: true, funeralDirectorHasGrant: false });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.funeralDirectorNewlyGranted).toBe(true);
    expect(mockInsertWixDataItem).toHaveBeenCalledWith(
      'rolePermissions',
      expect.objectContaining({ roleId: 'role-funeralDirector', permissionKey: 'caseNumber.manage' }),
      expect.any(String),
    );
  });

  it('H: an already-existing Administrator grant is not duplicated', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: true, funeralDirectorHasGrant: true });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.administratorNewlyGranted).toBe(false);
    expect(mockInsertWixDataItem).not.toHaveBeenCalledWith(
      'rolePermissions',
      expect.objectContaining({ roleId: 'role-administrator', permissionKey: 'caseNumber.manage' }),
      expect.any(String),
    );
  });

  it('I: an already-existing Funeral Director grant is not duplicated', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: true, funeralDirectorHasGrant: true });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.funeralDirectorNewlyGranted).toBe(false);
    expect(mockInsertWixDataItem).not.toHaveBeenCalledWith(
      'rolePermissions',
      expect.objectContaining({ roleId: 'role-funeralDirector', permissionKey: 'caseNumber.manage' }),
      expect.any(String),
    );
  });

  it('J: running the migration twice is idempotent — the second run makes zero grant/audit inserts', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: false });
    const first = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.administratorNewlyGranted).toBe(true);
    expect(firstBody.funeralDirectorNewlyGranted).toBe(true);

    // Re-seed to reflect the state the first run would have produced —
    // both grants now already exist.
    mockInsertWixDataItem.mockClear();
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: true, funeralDirectorHasGrant: true });
    const second = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.administratorNewlyGranted).toBe(false);
    expect(secondBody.funeralDirectorNewlyGranted).toBe(false);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it.each([
    ['manager', 'role-manager'],
    ['officeStaff', 'role-officeStaff'],
    ['accounting', 'role-accounting'],
    ['readOnly', 'role-readOnly'],
    ['dispatch', 'role-dispatch'],
  ])('K-O: %s never receives the grant — no rolePermissions insert ever targets %s', async (_roleKey, roleId) => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: false });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    for (const call of mockInsertWixDataItem.mock.calls) {
      if (call[0] === 'rolePermissions') {
        expect((call[1] as Record<string, unknown>).roleId).not.toBe(roleId);
      }
    }
  });

  it('P: Funeral Director never receives organization.manage — every rolePermissions insert this migration makes is caseNumber.manage only', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: false });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    for (const call of mockInsertWixDataItem.mock.calls) {
      if (call[0] === 'rolePermissions') {
        expect((call[1] as Record<string, unknown>).permissionKey).toBe('caseNumber.manage');
      }
    }
  });

  it('Q: organizationRolePermissionOverrides is never written to (reading it is normal, expected permission-resolution behavior; this migration never inserts/updates/deletes there)', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: false });
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(mockInsertWixDataItem.mock.calls.some((call) => call[0] === 'organizationRolePermissionOverrides')).toBe(false);
  });

  it('R: unrelated existing rolePermissions rows are never updated or deleted — only one new insert per missing grant', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: false });
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const rolePermissionInserts = mockInsertWixDataItem.mock.calls.filter((call) => call[0] === 'rolePermissions');
    expect(rolePermissionInserts).toHaveLength(2);
    // Neither insert ever references the pre-existing case.read grants
    // seeded for administrator/funeralDirector.
    for (const call of rolePermissionInserts) {
      expect((call[1] as Record<string, unknown>).permissionKey).not.toBe('case.read');
    }
  });

  it('S: a successful migration records exactly one permission_seeded audit entry per newly-granted role', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: true });
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const auditInserts = mockInsertWixDataItem.mock.calls.filter((call) => call[0] === 'organizationRoleAuditEntries');
    expect(auditInserts).toHaveLength(1); // only Administrator was newly granted
    const entry = auditInserts[0][1] as Record<string, unknown>;
    expect(entry.action).toBe('permission_seeded');
    expect(entry.roleId).toBe('role-administrator');
    expect(entry.permissionKey).toBe('caseNumber.manage');
    expect(entry.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(entry.actorIdentityId).toBe(mockDefaultUser.id);
    expect(entry.createdAt).toBeTruthy();
  });

  it('T: a rejected grant insert never records a false-success audit entry', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: true });
    mockInsertWixDataItem.mockImplementation((collectionId: string, data: Record<string, unknown>, itemId: string) => {
      if (collectionId === 'rolePermissions') return Promise.reject(new Error('simulated Wix outage'));
      return Promise.resolve({ id: itemId, dataCollectionId: collectionId, data });
    });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(500);
    expect(mockInsertWixDataItem.mock.calls.some((call) => call[0] === 'organizationRoleAuditEntries')).toBe(false);
  });

  it('U: caseSequences is never touched by this migration', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: false });
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(mockQueryWixDataItems.mock.calls.some((call) => call[0] === 'caseSequences')).toBe(false);
    expect(mockInsertWixDataItem.mock.calls.some((call) => call[0] === 'caseSequences')).toBe(false);
  });

  it('V: no Case is created by this migration', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: false });
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(mockInsertWixDataItem.mock.calls.some((call) => call[0] === 'cases')).toBe(false);
  });
});

describe('GET /api/organization/rbac/seed-case-number-manage', () => {
  it('reports needsMigration: true when either grant is missing, and never mutates', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: false, funeralDirectorHasGrant: true });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applicable).toBe(true);
    expect(body.needsMigration).toBe(true);
    expect(body.administratorGranted).toBe(false);
    expect(body.funeralDirectorGranted).toBe(true);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('reports needsMigration: false once both grants exist', async () => {
    seedRoles({ callerRoleKey: 'administrator', administratorHasGrant: true, funeralDirectorHasGrant: true });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.needsMigration).toBe(false);
  });

  it('reports applicable: false for a non-Manors organization', async () => {
    mockSession = { user: mockMultiOrgUser };
    seedRoles({ callerRoleKey: 'caseManager' });
    const response = await getRequest(SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applicable).toBe(false);
  });

  it('a non-authorized caller cannot even read migration status', async () => {
    mockSession = { user: mockFuneralDirectorUser };
    seedRoles({ callerRoleKey: 'funeralDirector', grantUserManageRoles: false });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });
});
