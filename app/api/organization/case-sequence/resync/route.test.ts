import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import {
  mockDefaultUser,
  mockMultiOrgUser,
  mockManagerUser,
  mockOfficeStaffUser,
  mockAccountingUser,
  mockReadOnlyUser,
  mockDispatchUser,
} from '@/services/__mocks__/authFixtures';

/**
 * Case-number sequence resync (2026-10). Mirrors the go-live cutover
 * route's own test harness: real `getCaseSequenceState`/
 * `initializeCaseSequence` run against a mocked `lib/wixDataApi` layer, so
 * the actual insert/409/PUT branching is exercised rather than stubbed.
 *
 * The scenario throughout is the real live defect: `nextSequence` is 36
 * while B2026-036 already exists (imported from Jotform), so the next
 * normally-allocated case would duplicate it.
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

// Proves the resync never allocates a number through the normal path.
vi.mock('@/lib/wixCaseNumberSequence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wixCaseNumberSequence')>('@/lib/wixCaseNumberSequence');
  return { ...actual, reserveNextCaseNumber: vi.fn() };
});

const mockGetOrganization = vi.fn();
vi.mock('@/services/organizationProvisioningService', async () => {
  const actual = await vi.importActual<typeof import('@/services/organizationProvisioningService')>(
    '@/services/organizationProvisioningService',
  );
  return { ...actual, getOrganization: (...args: unknown[]) => mockGetOrganization(...args) };
});

const mockRecordCaseSequenceInitialized = vi.fn();
vi.mock('@/services/activityService', async () => {
  const actual = await vi.importActual<typeof import('@/services/activityService')>('@/services/activityService');
  return { ...actual, recordCaseSequenceInitialized: (...args: unknown[]) => mockRecordCaseSequenceInitialized(...args) };
});

const { GET, POST } = await import('./route');
const { WixDataApiError } = await import('@/lib/wixDataApi');

/** `initializeCaseSequence` tries an INSERT first and only falls through
    to the UPDATE path on a real `WixDataApiError` 409 — so the sequence
    row's insert must reject with exactly that, not a plain Error. */
function insertRejectingExistingSequenceRow() {
  return vi.fn((collectionId: string, data: Record<string, unknown>, itemId: string) => {
    if (collectionId === 'caseSequences') return Promise.reject(new WixDataApiError('conflict', 409));
    return Promise.resolve({ id: itemId, dataCollectionId: collectionId, data });
  });
}

function getRequest(organizationId: string | null, year?: string) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  if (year !== undefined) params.set('year', year);
  return GET(new Request(`http://localhost/api/organization/case-sequence/resync?${params.toString()}`));
}

const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function postRequest(body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return POST(
    new Request('http://localhost/api/organization/case-sequence/resync', { method: 'POST', headers, body: JSON.stringify(body) }),
  );
}

const ROLE_ITEM = { id: 'role-administrator', dataCollectionId: 'roles', data: { beaconRoleId: 'role-administrator', key: 'administrator', name: 'Administrator', description: 'x', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } };
const ROLE_PERMISSION_ITEM = { id: 'rp-case-number-manage', dataCollectionId: 'rolePermissions', data: { beaconRolePermissionId: 'rp-case-number-manage', roleId: 'role-administrator', permissionKey: 'caseNumber.manage', createdAt: '2026-01-01T00:00:00.000Z' } };

function caseSequenceRow(organizationId: string, year: number, nextSequence: number) {
  return { id: `${organizationId}-${year}`, dataCollectionId: 'caseSequences', data: { organizationId, year, nextSequence } };
}

function caseRow(organizationId: string, caseNumber: string) {
  return { id: `case-${caseNumber}`, dataCollectionId: 'cases', data: { organizationId, caseNumber } };
}

/** Seeds the mocked Wix layer: administrator permission always granted,
    plus whatever caseSequences/cases rows the test needs. `cases` is
    always queried by exact `{ organizationId, caseNumber }`. */
function seedState(options: { sequenceRow?: ReturnType<typeof caseSequenceRow> | null; existingCaseNumbers?: string[]; organizationId?: string }) {
  const { sequenceRow = null, existingCaseNumbers = [], organizationId = DEFAULT_ORGANIZATION_ID } = options;
  const caseRows = existingCaseNumbers.map((n) => caseRow(organizationId, n));
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
  mockInsertWixDataItem = insertRejectingExistingSequenceRow();
  mockUpdateWixDataItem = vi.fn((collectionId: string, itemId: string, data: Record<string, unknown>) =>
    Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }),
  );
  mockGetOrganization.mockResolvedValue({ id: DEFAULT_ORGANIZATION_ID, timezone: 'America/New_York' });
  mockRecordCaseSequenceInitialized.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  vi.clearAllMocks();
});

describe('GET /api/organization/case-sequence/resync', () => {
  it('A: detects the real live lag — nextSequence 36 with B2026-036 already in use', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-034', 'B2026-035', 'B2026-036'] });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, '2026');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.needsResync).toBe(true);
    expect(body.currentNextSequence).toBe(36);
    expect(body.targetNextSequence).toBe(37);
    expect(body.currentCaseNumber).toBe('B2026-036');
    expect(body.targetCaseNumber).toBe('B2026-037');
    expect(body.collidingCaseNumbers).toEqual(['B2026-036']);
    expect(body.reason).toBeNull();
  });

  it('B: reports no resync needed when the queued number is free', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 37), existingCaseNumbers: ['B2026-036'] });
    const body = await (await getRequest(DEFAULT_ORGANIZATION_ID, '2026')).json();
    expect(body.needsResync).toBe(false);
    expect(body.targetNextSequence).toBe(37);
    expect(body.reason).toMatch(/already correct/);
  });

  it('C: walks past a run of consecutive imported numbers', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-036', 'B2026-037', 'B2026-038'] });
    const body = await (await getRequest(DEFAULT_ORGANIZATION_ID, '2026')).json();
    expect(body.needsResync).toBe(true);
    expect(body.targetCaseNumber).toBe('B2026-039');
    expect(body.collidingCaseNumbers).toEqual(['B2026-036', 'B2026-037', 'B2026-038']);
  });

  it('D: a gap below the counter is never back-filled — only forward from nextSequence', async () => {
    // B2026-030 is free but was already issued historically; the counter
    // must never be dragged back to reuse it.
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-036'] });
    const body = await (await getRequest(DEFAULT_ORGANIZATION_ID, '2026')).json();
    expect(body.targetNextSequence).toBe(37);
    expect(body.targetNextSequence).toBeGreaterThan(body.currentNextSequence);
  });

  it('E: no sequence row at all is reported as nothing to resync, not as a lag', async () => {
    seedState({ sequenceRow: null });
    const body = await (await getRequest(DEFAULT_ORGANIZATION_ID, '2026')).json();
    expect(body.needsResync).toBe(false);
    expect(body.currentNextSequence).toBeNull();
    expect(body.reason).toMatch(/No 2026 case sequence exists yet/);
  });

  it('F: fails closed rather than skipping past more than 50 consecutive existing numbers', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `B2026-${String(36 + i).padStart(3, '0')}`);
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: many });
    const body = await (await getRequest(DEFAULT_ORGANIZATION_ID, '2026')).json();
    expect(body.needsResync).toBe(false);
    expect(body.targetNextSequence).toBeNull();
    expect(body.reason).toMatch(/More than 50 consecutive case numbers/);
  });

  it('G: requires organizationId', async () => {
    expect((await getRequest(null)).status).toBe(400);
  });

  it('H: rejects a malformed year', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36) });
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, 'not-a-year')).status).toBe(400);
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, '1999')).status).toBe(400);
  });

  it("I: falls back to the organization's own local year when no year is given", async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36) });
    const body = await (await getRequest(DEFAULT_ORGANIZATION_ID)).json();
    expect(mockGetOrganization).toHaveBeenCalled();
    expect(body.year).toBe(new Date().getFullYear());
  });

  it('J: a user without caseNumber.manage cannot even read the plan', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, '2026')).status).toBe(403);
  });

  it('K: 400s outside DATA_ADAPTER=wix', async () => {
    process.env.DATA_ADAPTER = 'mock';
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36) });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, '2026');
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/only applies when DATA_ADAPTER=wix/);
  });

  it('L: never mutates', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-036'] });
    await getRequest(DEFAULT_ORGANIZATION_ID, '2026');
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });
});

describe('POST /api/organization/case-sequence/resync', () => {
  it('M: advances the counter to the first free number and reports it', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-034', 'B2026-035', 'B2026-036'] });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nextSequence).toBe(37);
    expect(body.nextCaseNumber).toBe('B2026-037');

    expect(mockUpdateWixDataItem).toHaveBeenCalledWith('caseSequences', `${DEFAULT_ORGANIZATION_ID}-2026`, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      year: 2026,
      nextSequence: 37,
    });
  });

  it('N: records the audit event with the real before/after values', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-036'] });
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 });
    expect(mockRecordCaseSequenceInitialized).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID }),
      2026,
      36,
      37,
      'wix',
    );
  });

  it('O: 409s when there is nothing to resync — never writes', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 37), existingCaseNumbers: ['B2026-036'] });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 });
    expect(response.status).toBe(409);
    expect((await response.json()).needsResync).toBe(false);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    expect(mockRecordCaseSequenceInitialized).not.toHaveBeenCalled();
  });

  it('P: cannot run twice — the second call is a 409 once the lag is gone', async () => {
    let stored = 36;
    mockQueryWixDataItems.mockImplementation((collectionId: string, queryOptions?: { filter?: Record<string, unknown> }) => {
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [ROLE_ITEM] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: [ROLE_PERMISSION_ITEM] });
      if (collectionId === 'caseSequences') return Promise.resolve({ dataItems: [caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, stored)] });
      if (collectionId === 'cases') {
        const filter = queryOptions?.filter ?? {};
        return Promise.resolve({ dataItems: filter.caseNumber === 'B2026-036' ? [caseRow(DEFAULT_ORGANIZATION_ID, 'B2026-036')] : [] });
      }
      return Promise.resolve({ dataItems: [] });
    });
    mockUpdateWixDataItem.mockImplementation((_collection: string, _id: string, data: { nextSequence: number }) => {
      stored = data.nextSequence;
      return Promise.resolve({ data });
    });

    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 })).status).toBe(200);
    expect(stored).toBe(37);
    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 })).status).toBe(409);
  });

  it('Q: ignores any client-supplied target — there is no nextSequence input', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-036'] });
    const body = await (
      await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026, nextSequence: 999, targetNextSequence: 999 })
    ).json();
    expect(body.nextSequence).toBe(37);
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith('caseSequences', `${DEFAULT_ORGANIZATION_ID}-2026`, expect.objectContaining({ nextSequence: 37 }));
  });

  it('R: requires a same-origin request', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 }, { origin: 'http://evil.test', host: 'localhost', 'Content-Type': 'application/json' });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('S: rejects an invalid JSON body', async () => {
    const response = await POST(
      new Request('http://localhost/api/organization/case-sequence/resync', { method: 'POST', headers: SAME_ORIGIN_HEADERS, body: 'not json' }),
    );
    expect(response.status).toBe(400);
  });

  it('T: requires organizationId in the body', async () => {
    expect((await postRequest({ year: 2026 })).status).toBe(400);
  });

  it('U: 400s outside DATA_ADAPTER=wix without writing', async () => {
    process.env.DATA_ADAPTER = 'mock';
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-036'] });
    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 })).status).toBe(400);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('V: never creates or edits a Case', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-036'] });
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 });
    for (const call of mockUpdateWixDataItem.mock.calls) expect(call[0]).not.toBe('cases');
    for (const call of mockInsertWixDataItem.mock.calls) expect(call[0]).not.toBe('cases');
  });

  it('W: a successful resync still succeeds when the audit write fails', async () => {
    seedState({ sequenceRow: caseSequenceRow(DEFAULT_ORGANIZATION_ID, 2026, 36), existingCaseNumbers: ['B2026-036'] });
    mockRecordCaseSequenceInitialized.mockRejectedValue(new Error('audit down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 });
    expect(response.status).toBe(200);
    expect((await response.json()).nextSequence).toBe(37);
    errorSpy.mockRestore();
  });

  it('X: works for an organization other than Manors — this is not a one-org action', async () => {
    mockSession = { user: mockMultiOrgUser };
    mockGetOrganization.mockResolvedValue({ id: SECOND_MOCK_ORGANIZATION_ID, timezone: 'America/New_York' });
    seedState({ sequenceRow: caseSequenceRow(SECOND_MOCK_ORGANIZATION_ID, 2026, 12), existingCaseNumbers: ['B2026-012'], organizationId: SECOND_MOCK_ORGANIZATION_ID });
    const response = await postRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID, year: 2026 });
    expect(response.status).toBe(200);
    expect((await response.json()).nextCaseNumber).toBe('B2026-013');
  });
});

describe('RBAC — only roles holding caseNumber.manage can resync', () => {
  const unauthorized: Array<[string, typeof mockDefaultUser]> = [
    ['manager', mockManagerUser],
    ['officeStaff', mockOfficeStaffUser],
    ['accounting', mockAccountingUser],
    ['readOnly', mockReadOnlyUser],
    ['dispatch', mockDispatchUser],
  ];

  it.each(unauthorized)('%s is refused on both GET and POST', async (_label, user) => {
    mockSession = { user };
    // Roles/permissions deliberately left empty, so the policy resolves
    // false naturally rather than via a hardcoded role list here.
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, '2026')).status).toBe(403);
    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, year: 2026 })).status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });
});
