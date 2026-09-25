import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

/**
 * Manors go-live case-number cutover (2026-09). `DEFAULT_ORGANIZATION_ID`
 * ('managed-cremations') is used throughout as the real Manors org —
 * this route is hardcoded to exactly that id, so these tests exercise the
 * real eligibility gate rather than a stand-in.
 */

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

// L: proves the cutover never calls reserveNextCaseNumber — real
// initializeCaseSequence/getCaseSequenceState still run for real against
// the mocked wixDataApi layer above.
vi.mock('@/lib/wixCaseNumberSequence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wixCaseNumberSequence')>('@/lib/wixCaseNumberSequence');
  return { ...actual, reserveNextCaseNumber: vi.fn() };
});

const { GET, POST } = await import('./route');

function getRequest(organizationId: string | null) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  return GET(new Request(`http://localhost/api/organization/case-sequence/manors-go-live-cutover?${params.toString()}`));
}

const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function postRequest(body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return POST(new Request('http://localhost/api/organization/case-sequence/manors-go-live-cutover', { method: 'POST', headers, body: JSON.stringify(body) }));
}

const ROLE_ITEM = { id: 'role-administrator', dataCollectionId: 'roles', data: { beaconRoleId: 'role-administrator', key: 'administrator', name: 'Administrator', description: 'x', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } };
const ROLE_PERMISSION_ITEM = { id: 'rp-org-manage', dataCollectionId: 'rolePermissions', data: { beaconRolePermissionId: 'rp-org-manage', roleId: 'role-administrator', permissionKey: 'organization.manage', createdAt: '2026-01-01T00:00:00.000Z' } };

function caseSequenceRow(organizationId: string, year: number, nextSequence: number) {
  return { id: `${organizationId}-${year}`, dataCollectionId: 'caseSequences', data: { organizationId, year, nextSequence } };
}

function caseRow(organizationId: string, caseNumber: string) {
  return { id: `case-${caseNumber}`, dataCollectionId: 'cases', data: { organizationId, caseNumber, beaconCaseId: `case-${caseNumber}`, currentStage: 0, checklistState: {}, fieldValues: {}, decedentName: 'X', dateOfBirth: '', dateOfDeath: '', timeOfDeath: '', placeOfDeath: '', weight: '', nextOfKinName: 'X', nextOfKinPhone: 'X', paymentStatus: 'awaiting_payment', pickupStatus: 'awaiting_pickup', isDeleted: false, isArchived: false } };
}

/** Seeds a fully custom mockQueryWixDataItems: administrator permission
    always granted, plus whatever caseSequences/cases rows the test needs. */
function seedState(options: { sequenceRow?: ReturnType<typeof caseSequenceRow> | null; caseRows?: ReturnType<typeof caseRow>[] }) {
  const { sequenceRow = null, caseRows = [] } = options;
  mockQueryWixDataItems.mockImplementation((collectionId: string, queryOptions?: { filter?: Record<string, unknown> }) => {
    if (collectionId === 'roles') return Promise.resolve({ dataItems: [ROLE_ITEM] });
    if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: [ROLE_PERMISSION_ITEM] });
    if (collectionId === 'caseSequences') return Promise.resolve({ dataItems: sequenceRow ? [sequenceRow] : [] });
    if (collectionId === 'cases') {
      const filter = queryOptions?.filter ?? {};
      const matches = caseRows.filter((row) => row.data.caseNumber === filter.caseNumber && row.data.organizationId === filter.organizationId);
      return Promise.resolve({ dataItems: matches });
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
  mockInsertWixDataItem = vi.fn();
  mockUpdateWixDataItem = vi.fn();
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  vi.clearAllMocks();
});

describe('GET /api/organization/case-sequence/manors-go-live-cutover', () => {
  it('A: reports eligible when the sequence is exactly 34 and no historical/target Case numbers exist', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34) });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.eligible).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.currentNextSequence).toBe(34);
    expect(body.firstNormalCaseNumber).toBe('B2026-036');
    expect(body.historicalCaseNumbers).toEqual(['B2026-034', 'B2026-035']);
  });

  it('B: a non-authorized user cannot even read eligibility', async () => {
    // officeStaff on DEFAULT_ORGANIZATION_ID, no organization.manage — the
    // default mock (empty roles/rolePermissions from beforeEach) already
    // grants nothing, so canManageOrganization resolves false naturally.
    mockSession = { user: mockMultiOrgUser };
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('C: a different organization is blocked, even for an administrator there', async () => {
    // mockMultiOrgUser has membership in SECOND_MOCK_ORGANIZATION_ID, so
    // requireAuthorizedOrganization succeeds and we reach the eligibility
    // gate itself, proving THIS check (not auth) is what blocks it.
    mockSession = { user: mockMultiOrgUser };
    seedState({ sequenceRow: caseSequenceRow(SECOND_MOCK_ORGANIZATION_ID, 2026, 34) });
    const response = await getRequest(SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.eligible).toBe(false);
    expect(body.reason).toMatch(/only available for the Manors organization/);
  });

  it('D: no 2026 sequence row at all blocks (distinguishes from year mismatch)', async () => {
    seedState({ sequenceRow: null });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.eligible).toBe(false);
    expect(body.currentNextSequence).toBeNull();
    expect(body.reason).toMatch(/No 2026 case sequence exists yet/);
  });

  it('E: a sequence value other than 34 blocks', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 17) });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.eligible).toBe(false);
    expect(body.currentNextSequence).toBe(17);
    expect(body.reason).toMatch(/currently 17, not the expected 34/);
  });

  it('F: an existing B2026-034 Case blocks', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34), caseRows: [caseRow(DEFAULT_ORGANIZATION_ID, 'B2026-034')] });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.eligible).toBe(false);
    expect(body.reason).toMatch(/B2026-034/);
  });

  it('G: an existing B2026-035 Case blocks', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34), caseRows: [caseRow(DEFAULT_ORGANIZATION_ID, 'B2026-035')] });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.eligible).toBe(false);
    expect(body.reason).toMatch(/B2026-035/);
  });

  it('H: an existing B2026-036 Case blocks', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34), caseRows: [caseRow(DEFAULT_ORGANIZATION_ID, 'B2026-036')] });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.eligible).toBe(false);
    expect(body.reason).toMatch(/B2026-036/);
  });

  it('I: loading the page (GET) never mutates anything, even when eligible', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34) });
    await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });
});

describe('POST /api/organization/case-sequence/manors-go-live-cutover', () => {
  it('J: a successful cutover sets nextSequence to 36', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34) });
    mockUpdateWixDataItem.mockImplementation((collectionId: string, itemId: string, data: Record<string, unknown>) => Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }));
    // insertWixDataItem for caseSequences must reject with a real WixDataApiError (409) so initializeCaseSequence's own existing-row detection falls through to the update path.
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    mockInsertWixDataItem.mockImplementation((collectionId: string, data: Record<string, unknown>, itemId: string) => {
      if (collectionId === 'caseSequences') return Promise.reject(new WixDataApiError('conflict', 409));
      return Promise.resolve({ id: itemId, dataCollectionId: collectionId, data });
    });

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nextSequence).toBe(36);
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith('caseSequences', `${DEFAULT_ORGANIZATION_ID}-2026`, { organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 36 });
  });

  it('K: success never creates a Case (no insert into the cases collection)', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34) });
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    mockInsertWixDataItem.mockImplementation((collectionId: string, data: Record<string, unknown>, itemId: string) => {
      if (collectionId === 'caseSequences') return Promise.reject(new WixDataApiError('conflict', 409));
      return Promise.resolve({ id: itemId, dataCollectionId: collectionId, data });
    });
    mockUpdateWixDataItem.mockImplementation((collectionId: string, itemId: string, data: Record<string, unknown>) => Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }));

    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const caseInsertCall = mockInsertWixDataItem.mock.calls.find((call) => call[0] === 'cases');
    expect(caseInsertCall).toBeUndefined();
  });

  it('L: success never calls reserveNextCaseNumber', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34) });
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    mockInsertWixDataItem.mockImplementation((collectionId: string, data: Record<string, unknown>, itemId: string) => {
      if (collectionId === 'caseSequences') return Promise.reject(new WixDataApiError('conflict', 409));
      return Promise.resolve({ id: itemId, dataCollectionId: collectionId, data });
    });
    mockUpdateWixDataItem.mockImplementation((collectionId: string, itemId: string, data: Record<string, unknown>) => Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }));

    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const { reserveNextCaseNumber } = await import('@/lib/wixCaseNumberSequence');
    expect(reserveNextCaseNumber).not.toHaveBeenCalled();
  });

  it('M: a successful cutover records case.sequence.initialized with 34 -> 36', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34) });
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    mockInsertWixDataItem.mockImplementation((collectionId: string, data: Record<string, unknown>, itemId: string) => {
      if (collectionId === 'caseSequences') return Promise.reject(new WixDataApiError('conflict', 409));
      return Promise.resolve({ id: itemId, dataCollectionId: collectionId, data });
    });
    mockUpdateWixDataItem.mockImplementation((collectionId: string, itemId: string, data: Record<string, unknown>) => Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }));

    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const activityCall = mockInsertWixDataItem.mock.calls.find((call) => call[0] === 'activityEvents');
    expect(activityCall).toBeTruthy();
    const eventData = activityCall![1] as Record<string, unknown>;
    expect(eventData.eventType).toBe('case.sequence.initialized');
    expect(JSON.parse(eventData.previousValue as string)).toEqual({ nextSequence: 34 });
    expect(JSON.parse(eventData.newValue as string)).toEqual({ nextSequence: 36 });
  });

  it('O: after a successful cutover, eligibility is re-checked as false (the action cannot run twice)', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34) });
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    mockInsertWixDataItem.mockImplementation((collectionId: string, data: Record<string, unknown>, itemId: string) => {
      if (collectionId === 'caseSequences') return Promise.reject(new WixDataApiError('conflict', 409));
      return Promise.resolve({ id: itemId, dataCollectionId: collectionId, data });
    });
    mockUpdateWixDataItem.mockImplementation((collectionId: string, itemId: string, data: Record<string, unknown>) => Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }));

    const postResponse = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(postResponse.status).toBe(200);

    // Simulate the post-cutover state for a follow-up GET.
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36) });
    const getResponse = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await getResponse.json();
    expect(body.eligible).toBe(false);
    expect(body.currentNextSequence).toBe(36);
  });

  it('P: a failed precondition (duplicate B2026-034) causes zero mutation', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 34), caseRows: [caseRow(DEFAULT_ORGANIZATION_ID, 'B2026-034')] });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(409);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('a non-authorized user cannot execute the cutover', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      { origin: 'https://evil.example.com', host: 'localhost', 'Content-Type': 'application/json' },
    );
    expect(response.status).toBe(403);
  });

  it('a sequence value other than 34 blocks execution too (server-side revalidation, not just GET)', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 5) });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(409);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });
});
