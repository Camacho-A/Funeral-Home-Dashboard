import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { orgLocalYear } from '@/domain/cases/caseNumber';
import { createHistoricalCaseNumberAuthorization } from '@/lib/auth/historicalCaseNumberAuthorization';
import type { Case } from '@/types/case';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockInsertWixDataItem = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    // Manors go-live pagination fix (2026-09): permissionService's
    // fetchRolePermissions now calls queryAllWixDataItems instead of
    // queryWixDataItems directly. Every canned rolePermissions/roles
    // response in this file is a single, complete page (well under Wix's
    // real 50-item cap), so delegating straight to the same
    // mockQueryWixDataItems implementation reproduces that page correctly
    // with zero change to any existing mockImplementation in this file.
    queryAllWixDataItems: async (collectionId: string, filter?: Record<string, unknown>) => {
      getWixServerConfig();
      const response = await mockQueryWixDataItems(collectionId, { filter });
      return response.dataItems;
    },
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
  };
});

// Phase 16B (Case Number Generation): mocked at the module boundary so
// these tests don't need to also simulate the caseSequences collection —
// lib/wixCaseNumberSequence.test.ts already exercises that logic directly.
let mockReserveNextCaseNumber = vi.fn().mockResolvedValue('B2026-001');
let mockAdvanceCaseSequencePast = vi.fn().mockResolvedValue({ nextSequence: 1, advanced: false });
vi.mock('@/lib/wixCaseNumberSequence', () => ({
  reserveNextCaseNumber: (...args: unknown[]) => mockReserveNextCaseNumber(...args),
  advanceCaseSequencePast: (...args: unknown[]) => mockAdvanceCaseSequencePast(...args),
}));

// Manors launch-prep — P0: the case-number year is resolved via the
// organization's own local timezone (domain/cases/caseNumber.ts's
// orgLocalYear), never the server's/UTC's — defaults to null (no
// organization record, UTC fallback) unless a test needs a specific
// timezone to prove the org-local-vs-UTC distinction.
let mockGetOrganization = vi.fn().mockResolvedValue(null);
vi.mock('@/services/organizationProvisioningService', () => ({
  getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
}));

// Phase 15X (Multi-Tenant Authorization Hardening): see the identical
// comment in app/api/organizations/[organizationId]/route.test.ts. Tests
// that legitimately need to reach the second organization use
// mockMultiOrgUser, which has active memberships in both.
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, POST } = await import('./route');

const WORKFLOW_TEMPLATE_ITEM = {
  id: 'workflow-template-standard-cremation',
  dataCollectionId: 'workflowTemplates',
  data: {
    beaconTemplateId: 'workflow-template-standard-cremation',
    organizationId: DEFAULT_ORGANIZATION_ID,
    isSystemTemplate: false,
    name: 'Standard Cremation Workflow',
    isEnabled: true,
    caseTypes: ['cremation'],
  },
};
const WORKFLOW_TEMPLATE_VERSION_ITEM = {
  id: 'v1',
  dataCollectionId: 'workflowTemplateVersions',
  data: {
    beaconTemplateId: 'workflow-template-standard-cremation',
    version: 1,
    caseTypes: ['cremation'],
    stages: [{ rawStage: 0, displayStage: 0, label: 'First Call & Payment', slaTargetDays: 1, checklist: { items: [] } }],
    intake: { sections: [] },
    createdAt: '2026-07-22T00:49:03.000Z',
  },
};

// Phase 30 (Identity Model Hardening & Staff Assignment Unification): the
// POST route resolves the caller's own StaffProfile server-side via
// resolveStaffProfileForCaller — a mock-user-dana row, matching this
// file's existing convention of createdBy/intakeOwnerId 'staff-dana'.
const CALLER_STAFF_PROFILE_ITEM = {
  id: 'staff-dana',
  dataCollectionId: 'staffProfiles',
  data: {
    beaconStaffProfileId: 'staff-dana',
    organizationId: DEFAULT_ORGANIZATION_ID,
    identityId: mockDefaultUser.id,
    membershipId: null,
    displayName: 'Dana',
    role: 'funeral_director',
    isActive: true,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  },
};

// Phase 30: assertAssignableStaffProfile's permission check resolves
// mockDefaultUser's real role ('administrator', per authFixtures.ts) —
// under DATA_ADAPTER=wix this means the 'roles'/'rolePermissions'
// collections must be mocked too, not just 'staffProfiles'.
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
// Manors go-live fix: 'case.create'/'case.reassign' added alongside the
// pre-existing set — every POST test below now goes through the route's
// new canCreateCase gate first, and the reassignment tests specifically
// need case.reassign to name a staff member other than the caller.
const ADMINISTRATOR_ROLE_PERMISSION_ITEMS = ['case.read', 'case.update', 'case.create', 'case.reassign', 'task.assign'].map((permissionKey) => ({
  id: `role-permission-administrator-${permissionKey}`,
  dataCollectionId: 'rolePermissions',
  data: {
    beaconRolePermissionId: `role-permission-administrator-${permissionKey}`,
    roleId: 'role-administrator',
    permissionKey,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
}));

/** A filter-aware staffProfiles mock (unlike mockEnabledTemplate's blanket
    per-collection responses) — needed whenever a test cares about
    *which* staffProfileId was actually queried, e.g. rejecting a
    nonexistent one. */
function mockCasesRoutesWithStaffProfiles(profileItems: typeof CALLER_STAFF_PROFILE_ITEM[]) {
  mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
    if (collectionId === 'workflowTemplates') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_ITEM] });
    if (collectionId === 'workflowTemplateVersions') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_VERSION_ITEM] });
    if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
    if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
    if (collectionId === 'staffProfiles') {
      const filter = options?.filter ?? {};
      const matches = profileItems.filter(
        (item) =>
          (filter.identityId === undefined || item.data.identityId === filter.identityId) &&
          (filter.beaconStaffProfileId === undefined || item.data.beaconStaffProfileId === filter.beaconStaffProfileId) &&
          (filter.organizationId === undefined || item.data.organizationId === filter.organizationId),
      );
      return Promise.resolve({ dataItems: matches });
    }
    return Promise.resolve({ dataItems: [] });
  });
}

/** Collection-aware mock for the GET /api/cases (list) wix-mode tests —
    'roles'/'rolePermissions' always resolve the administrator seed above
    (case.read included), 'cases' resolves to whatever the test passes. */
function mockCasesListQuery(caseItems: { id: string; dataCollectionId: string; data: unknown }[]) {
  mockQueryWixDataItems.mockImplementation((collectionId: string) => {
    if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
    if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
    if (collectionId === 'cases') return Promise.resolve({ dataItems: caseItems });
    return Promise.resolve({ dataItems: [] });
  });
}

function mockEnabledTemplate() {
  mockQueryWixDataItems.mockImplementation((collectionId: string) => {
    if (collectionId === 'workflowTemplates') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_ITEM] });
    if (collectionId === 'workflowTemplateVersions') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_VERSION_ITEM] });
    if (collectionId === 'staffProfiles') return Promise.resolve({ dataItems: [CALLER_STAFF_PROFILE_ITEM] });
    if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
    if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
    return Promise.resolve({ dataItems: [] });
  });
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_CREATE_BODY = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  decedentName: 'Test Decedent',
  nextOfKinName: 'Test NOK',
  nextOfKinPhone: '555-0000',
  createdBy: 'staff-dana',
  intakeOwnerId: 'staff-dana',
};

function requestFor(organizationId: string | null, searchQuery?: string) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  if (searchQuery) params.set('searchQuery', searchQuery);
  return new Request(`http://localhost/api/cases?${params.toString()}`);
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
  mockInsertWixDataItem = vi.fn();
  mockReserveNextCaseNumber = vi.fn().mockResolvedValue('B2026-001');
  mockAdvanceCaseSequencePast = vi.fn().mockResolvedValue({ nextSequence: 1, advanced: false });
  mockGetOrganization = vi.fn().mockResolvedValue(null);
  mockSession = { user: mockDefaultUser };
});

afterEach(() => {
  vi.useRealTimers();
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('GET /api/cases — request validation', () => {
  it('returns 400 when organizationId is missing', async () => {
    const response = await GET(requestFor(null));
    expect(response.status).toBe(400);
  });
});

describe('GET /api/cases — authorization', () => {
  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    expect(response.status).toBe(401);
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });

  it("returns 403 (not an empty list) for the single-org default user requesting the second organization — a forged organizationId is rejected before any fixture lookup", async () => {
    const response = await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.cases).toBeUndefined();
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });
});

describe('GET /api/cases — mock mode', () => {
  it("lists only this organization's non-deleted cases", async () => {
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cases.length).toBeGreaterThan(0);
    expect(body.cases.every((c: { organizationId: string; isDeleted: boolean }) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)).toBe(true);
  });

  it("a user authorized for the second organization gets an empty list for it (it has no case fixtures), never organization A's cases", async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID));
    const body = await response.json();
    expect(body.cases).toEqual([]);
  });

  it('applies the search query the same way casesService.list always did', async () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted);
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID, known!.decedentName));
    const body = await response.json();
    expect(body.cases.some((c: { id: string }) => c.id === known!.id)).toBe(true);
  });
});

describe('GET /api/cases — wix mode', () => {
  it('fails cleanly with a clear message when required config is missing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.cases).toEqual([]);
    expect(body.error).toMatch(/WIX_API_KEY, WIX_SITE_ID/);
  });

  it('maps a real Wix query result to the domain shape and applies organizationId + isArchived filter', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';

    mockCasesListQuery([
      {
        id: '1042',
        dataCollectionId: 'cases',
        data: {
          beaconCaseId: '1042',
          organizationId: DEFAULT_ORGANIZATION_ID,
          caseNumber: 'B2026-001',
          caseType: 'cremation',
          workflowTemplateId: 'workflow-template-standard-cremation',
          workflowTemplateVersion: 1,
          workflowSnapshot: {
            workflowTemplateId: 'workflow-template-standard-cremation',
            workflowTemplateVersion: 1,
            stages: [],
            intake: { sections: [] },
          },
          intakeOwnerId: 'staff-dana',
          caseHandlerId: 'staff-dana',
          currentStage: 0,
          checklistState: {},
          fieldValues: {},
          decedentName: 'Test Decedent',
          dateOfBirth: '01/01/2000',
          dateOfDeath: '01/01/2026',
          timeOfDeath: '00:00',
          placeOfDeath: 'Test Hospital',
          weight: '150 lb',
          nextOfKinName: 'Test NOK',
          nextOfKinPhone: '555-0000',
          paymentStatus: 'awaiting_payment',
          isVeteran: false,
          isArchived: false,
          createdAt: '2026-07-22T00:00:00.000Z',
        },
      },
    ]);

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0].id).toBe('1042');
    expect(body.cases[0].rawStage).toBe(0);
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('cases', {
      filter: { organizationId: DEFAULT_ORGANIZATION_ID, isArchived: false },
    });
  });

  it('returns an empty array for an authorized organization with no cases in Wix', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockCasesListQuery([]);

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cases).toEqual([]);
  });

  it('skips a malformed case record instead of throwing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockCasesListQuery([{ id: 'x', dataCollectionId: 'cases', data: { decedentName: 'Missing required fields' } }]);

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cases).toEqual([]);
  });

  it('never leaks a raw API key value into the response, even on failure', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'super-secret-test-value';

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const bodyText = await response.text();
    expect(bodyText).not.toContain('super-secret-test-value');
  });
});

/**
 * Case list scalability, Phase 1 (2026-09). Proves the new pagination
 * contract in wix mode: `limit`/`cursor` opt into a bounded page with an
 * honest `hasMore`/`nextCursor`, deterministic order (createdAt DESC,
 * caseNumber DESC — see lib/casePagination.ts), and organization isolation
 * that holds even if a cursor is forged. `queryAllWixDataItems`'s own
 * multi-page-looping mechanics are already proven independently in
 * lib/wixDataApi.test.ts ("Manors go-live incident fix") — these tests
 * only prove this ROUTE now delegates to it (for the legacy, no-params
 * shape) and correctly drives the bounded, cursor-based mode.
 */
describe('GET /api/cases — wix mode pagination (Case list scalability, Phase 1)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  function caseItem(id: string, caseNumber: string, createdAt: string) {
    return {
      id,
      dataCollectionId: 'cases',
      data: {
        beaconCaseId: id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseNumber,
        caseType: 'cremation',
        workflowTemplateId: 'workflow-template-standard-cremation',
        workflowTemplateVersion: 1,
        workflowSnapshot: {
          workflowTemplateId: 'workflow-template-standard-cremation',
          workflowTemplateVersion: 1,
          stages: [],
          intake: { sections: [] },
        },
        intakeOwnerId: 'staff-dana',
        caseHandlerId: 'staff-dana',
        currentStage: 0,
        checklistState: {},
        fieldValues: {},
        decedentName: `Decedent ${id}`,
        dateOfBirth: '01/01/2000',
        dateOfDeath: '01/01/2026',
        timeOfDeath: '00:00',
        placeOfDeath: 'Test Hospital',
        weight: '150 lb',
        nextOfKinName: 'Test NOK',
        nextOfKinPhone: '555-0000',
        paymentStatus: 'awaiting_payment',
        isVeteran: false,
        isArchived: false,
        createdAt,
      },
    };
  }

  /** A paging-aware 'cases' mock: honors `paging.limit`/`paging.cursor`
      against a fixed, caller-supplied (already correctly-ordered) item
      array — a call with NO `paging` at all (the legacy/queryAllWixDataItems
      shape) gets everything in one shot, matching that path's real,
      independently-tested looping behavior. */
  function mockPagedCasesListQuery(allCaseItems: ReturnType<typeof caseItem>[]) {
    let pageSize = 0;
    mockQueryWixDataItems.mockImplementation(
      (collectionId: string, options?: { filter?: Record<string, unknown>; paging?: { limit?: number; cursor?: string } }) => {
        if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
        if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
        if (collectionId !== 'cases') return Promise.resolve({ dataItems: [] });

        if (!options?.paging) {
          return Promise.resolve({ dataItems: allCaseItems, pagingMetadata: { hasNext: false, cursors: { next: null } } });
        }

        const { limit, cursor } = options.paging;
        let offset = 0;
        if (typeof limit === 'number') {
          pageSize = limit;
        } else if (typeof cursor === 'string') {
          offset = Number(cursor);
        }
        const slice = allCaseItems.slice(offset, offset + pageSize);
        const nextOffset = offset + slice.length;
        const hasNext = nextOffset < allCaseItems.length;
        return Promise.resolve({
          dataItems: slice,
          pagingMetadata: { hasNext, cursors: { next: hasNext ? String(nextOffset) : null } },
        });
      },
    );
  }

  function requestWithPaging(organizationId: string, params: Record<string, string>) {
    const search = new URLSearchParams({ organizationId, ...params });
    return new Request(`http://localhost/api/cases?${search.toString()}`);
  }

  it('1. fewer than one page: all cases returned, hasMore false', async () => {
    mockPagedCasesListQuery([caseItem('c1', 'B2026-002', '2026-02-01T00:00:00.000Z'), caseItem('c2', 'B2026-001', '2026-01-01T00:00:00.000Z')]);

    const body = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '10' }))).json();

    expect(body.cases).toHaveLength(2);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('2. exactly one full page: correct cases, correct (empty) continuation state', async () => {
    mockPagedCasesListQuery([caseItem('c1', 'B2026-002', '2026-02-01T00:00:00.000Z'), caseItem('c2', 'B2026-001', '2026-01-01T00:00:00.000Z')]);

    const body = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '2' }))).json();

    expect(body.cases).toHaveLength(2);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('3. more than one page: first page is bounded with hasMore true; a second request with the returned cursor retrieves the rest', async () => {
    mockPagedCasesListQuery([
      caseItem('c1', 'B2026-003', '2026-03-01T00:00:00.000Z'),
      caseItem('c2', 'B2026-002', '2026-02-01T00:00:00.000Z'),
      caseItem('c3', 'B2026-001', '2026-01-01T00:00:00.000Z'),
    ]);

    const page1 = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '2' }))).json();
    expect(page1.cases.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2']);
    expect(page1.hasMore).toBe(true);
    expect(typeof page1.nextCursor).toBe('string');

    const page2 = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '2', cursor: page1.nextCursor }))).json();
    expect(page2.cases.map((c: { id: string }) => c.id)).toEqual(['c3']);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it('4/5. no duplicate or skipped cases across a full pagination run', async () => {
    const items = Array.from({ length: 5 }, (_, i) => caseItem(`c${5 - i}`, `B2026-00${5 - i}`, `2026-0${5 - i}-01T00:00:00.000Z`));
    mockPagedCasesListQuery(items);

    const page1 = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '2' }))).json();
    const page2 = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '2', cursor: page1.nextCursor }))).json();
    const page3 = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '2', cursor: page2.nextCursor }))).json();

    const allIds = [...page1.cases, ...page2.cases, ...page3.cases].map((c: { id: string }) => c.id);
    expect(allIds).toEqual(['c5', 'c4', 'c3', 'c2', 'c1']);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(page3.hasMore).toBe(false);
  });

  it('6. the bounded-page query is issued with the deterministic createdAt DESC, caseNumber DESC sort', async () => {
    mockPagedCasesListQuery([caseItem('c1', 'B2026-001', '2026-01-01T00:00:00.000Z')]);
    await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '10' }));

    expect(mockQueryWixDataItems).toHaveBeenCalledWith(
      'cases',
      expect.objectContaining({
        sort: [
          { fieldName: 'createdAt', order: 'DESC' },
          { fieldName: 'caseNumber', order: 'DESC' },
        ],
      }),
    );
  });

  it('7/8. organization isolation holds in paginated mode: the query always filters on the server-derived organizationId', async () => {
    mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
      if (collectionId !== 'cases') return Promise.resolve({ dataItems: [] });
      expect(options?.filter).toEqual({ organizationId: DEFAULT_ORGANIZATION_ID, isArchived: false });
      return Promise.resolve({ dataItems: [caseItem('c1', 'B2026-001', '2026-01-01T00:00:00.000Z')], pagingMetadata: { hasNext: false, cursors: { next: null } } });
    });

    const body = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '10' }))).json();
    expect(body.cases.every((c: { organizationId: string }) => c.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(true);
  });

  it('12. empty organization: cases = [], hasMore = false', async () => {
    mockPagedCasesListQuery([]);
    const body = await (await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '10' }))).json();

    expect(body.cases).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('13. a tampered/garbage cursor is rejected with 400 rather than producing undefined behavior', async () => {
    mockPagedCasesListQuery([caseItem('c1', 'B2026-001', '2026-01-01T00:00:00.000Z')]);
    const response = await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '10', cursor: 'not-a-real-cursor' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.cases).toEqual([]);
  });

  it('14. a cursor minted for a different organization is rejected outright — pagination cannot be used to bypass org scoping', async () => {
    mockPagedCasesListQuery([caseItem('c1', 'B2026-001', '2026-01-01T00:00:00.000Z')]);
    const foreignToken = Buffer.from(
      JSON.stringify({ v: 1, kind: 'wix', organizationId: 'some-other-org', searchQuery: '', wixCursor: 'whatever' }),
      'utf8',
    ).toString('base64url');

    const response = await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '10', cursor: foreignToken }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.cases).toEqual([]);
  });

  it('rejects a non-positive-integer limit with 400, before any Wix call', async () => {
    const response = await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '0' }));
    expect(response.status).toBe(400);
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });

  it('clamps a requested limit above the maximum page size rather than issuing an unbounded query', async () => {
    mockPagedCasesListQuery([caseItem('c1', 'B2026-001', '2026-01-01T00:00:00.000Z')]);
    await GET(requestWithPaging(DEFAULT_ORGANIZATION_ID, { limit: '999999' }));

    expect(mockQueryWixDataItems).toHaveBeenCalledWith('cases', expect.objectContaining({ paging: { limit: 200 } }));
  });
});

/**
 * Case list scalability, Phase 1 (2026-09). Backward compatibility: every
 * existing caller (casesService.ts's list(), the Dashboard) never sends
 * `limit`/`cursor` at all — this proves that shape still returns the
 * `{ cases: [...] }` contract unchanged, now additionally carrying
 * `hasMore: false, nextCursor: null` (additive, never a removed field).
 */
describe('GET /api/cases — backward compatibility (Case list scalability, Phase 1)', () => {
  it('mock mode: a legacy request with no pagination params still returns the complete set plus hasMore/nextCursor', async () => {
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cases.length).toBeGreaterThan(0);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('wix mode: a legacy request with no pagination params calls queryAllWixDataItems\'s underlying query with no `paging` at all (the exact assertion already covering the pre-Phase-1 shape) and adds hasMore/nextCursor', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockCasesListQuery([
      {
        id: '1042',
        dataCollectionId: 'cases',
        data: {
          beaconCaseId: '1042',
          organizationId: DEFAULT_ORGANIZATION_ID,
          caseNumber: 'B2026-001',
          caseType: 'cremation',
          workflowTemplateId: 'workflow-template-standard-cremation',
          workflowTemplateVersion: 1,
          workflowSnapshot: {
            workflowTemplateId: 'workflow-template-standard-cremation',
            workflowTemplateVersion: 1,
            stages: [],
            intake: { sections: [] },
          },
          intakeOwnerId: 'staff-dana',
          caseHandlerId: 'staff-dana',
          currentStage: 0,
          checklistState: {},
          fieldValues: {},
          decedentName: 'Test Decedent',
          dateOfBirth: '01/01/2000',
          dateOfDeath: '01/01/2026',
          timeOfDeath: '00:00',
          placeOfDeath: 'Test Hospital',
          weight: '150 lb',
          nextOfKinName: 'Test NOK',
          nextOfKinPhone: '555-0000',
          paymentStatus: 'awaiting_payment',
          isVeteran: false,
          isArchived: false,
          createdAt: '2026-07-22T00:00:00.000Z',
        },
      },
    ]);

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cases).toHaveLength(1);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('cases', { filter: { organizationId: DEFAULT_ORGANIZATION_ID, isArchived: false } });
  });
});

/**
 * Case list scalability, Phase 1 (2026-09). Mock mode follows the exact
 * same pagination contract as wix mode above (same field names, same
 * hasMore/nextCursor/cursor semantics) — proven against a second,
 * dedicated organization's temporarily-pushed fixtures so it never
 * interferes with any other test's assumptions about caseFixtures.
 */
describe('GET /api/cases — mock mode pagination (Case list scalability, Phase 1)', () => {
  const pushedIds: string[] = [];

  function pushMockCase(id: string, caseNumber: string, createdAt: string, overrides: Partial<Case> = {}) {
    const template = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
    caseFixtures.push({ ...template, ...overrides, id, organizationId: SECOND_MOCK_ORGANIZATION_ID, caseNumber, createdAt, isDeleted: overrides.isDeleted ?? false });
    pushedIds.push(id);
  }

  function requestWithPaging(organizationId: string, params: Record<string, string>) {
    const search = new URLSearchParams({ organizationId, ...params });
    return new Request(`http://localhost/api/cases?${search.toString()}`);
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

  it('1. fewer than one page: all cases returned, hasMore false', async () => {
    pushMockCase('pg-1', 'B2026-101', '2026-01-01T00:00:00.000Z');
    pushMockCase('pg-2', 'B2026-102', '2026-01-02T00:00:00.000Z');

    const body = await (await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '10' }))).json();

    expect(body.cases.map((c: { id: string }) => c.id).sort()).toEqual(['pg-1', 'pg-2']);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('2. exactly one full page: correct cases, correct (empty) continuation state', async () => {
    pushMockCase('pg-1', 'B2026-101', '2026-01-01T00:00:00.000Z');
    pushMockCase('pg-2', 'B2026-102', '2026-01-02T00:00:00.000Z');

    const body = await (await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '2' }))).json();

    expect(body.cases).toHaveLength(2);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('3/4/5. more than one page: bounded first page with hasMore true, second page retrieves the rest, no dupes/skips', async () => {
    pushMockCase('pg-1', 'B2026-101', '2026-01-01T00:00:00.000Z');
    pushMockCase('pg-2', 'B2026-102', '2026-01-02T00:00:00.000Z');
    pushMockCase('pg-3', 'B2026-103', '2026-01-03T00:00:00.000Z');

    const page1 = await (await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '2' }))).json();
    expect(page1.cases).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(typeof page1.nextCursor).toBe('string');

    const page2 = await (await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '2', cursor: page1.nextCursor }))).json();
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();

    const allIds = [...page1.cases, ...page2.cases].map((c: { id: string }) => c.id);
    expect(allIds).toEqual(['pg-3', 'pg-2', 'pg-1']);
    expect(new Set(allIds).size).toBe(3);
  });

  it('6. stable ordering: createdAt DESC, caseNumber DESC as the tiebreaker', async () => {
    pushMockCase('pg-1', 'B2026-101', '2026-01-01T00:00:00.000Z');
    pushMockCase('pg-2', 'B2026-102', '2026-01-01T00:00:00.000Z'); // identical createdAt

    const body = await (await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '10' }))).json();
    expect(body.cases.map((c: { id: string }) => c.id)).toEqual(['pg-2', 'pg-1']);
  });

  it('7/8. organization isolation: another organization\'s cases never appear in this organization\'s page', async () => {
    pushMockCase('pg-1', 'B2026-101', '2026-01-01T00:00:00.000Z');
    const body = await (await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '10' }))).json();
    expect(body.cases.every((c: { organizationId: string }) => c.organizationId === SECOND_MOCK_ORGANIZATION_ID)).toBe(true);
  });

  it('9. archived-case behavior is unchanged: a soft-deleted case never appears in a page', async () => {
    pushMockCase('pg-1', 'B2026-101', '2026-01-01T00:00:00.000Z');
    pushMockCase('pg-deleted', 'B2026-199', '2026-01-05T00:00:00.000Z', { isDeleted: true });

    const body = await (await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '10' }))).json();
    expect(body.cases.some((c: { id: string }) => c.id === 'pg-deleted')).toBe(false);
  });

  it('12. empty organization: cases = [], hasMore = false', async () => {
    const body = await (await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '10' }))).json();
    expect(body.cases).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('13. an invalid/garbage cursor is rejected with 400', async () => {
    pushMockCase('pg-1', 'B2026-101', '2026-01-01T00:00:00.000Z');
    const response = await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '10', cursor: 'garbage' }));
    expect(response.status).toBe(400);
  });

  it('14. a cursor minted for a different organization is rejected — pagination cannot bypass org scoping', async () => {
    pushMockCase('pg-1', 'B2026-101', '2026-01-01T00:00:00.000Z');
    const foreignToken = Buffer.from(
      JSON.stringify({ v: 1, kind: 'mock', organizationId: DEFAULT_ORGANIZATION_ID, searchQuery: '', offset: 0 }),
      'utf8',
    ).toString('base64url');

    const response = await GET(requestWithPaging(SECOND_MOCK_ORGANIZATION_ID, { limit: '10', cursor: foreignToken }));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/cases — authorization', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const response = await POST(postRequest(VALID_CREATE_BODY, { origin: 'https://evil.example.com' }));
    expect(response.status).toBe(403);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(401);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 403 for a forged organizationId the session has no membership in — rejected before any write', async () => {
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, organizationId: SECOND_MOCK_ORGANIZATION_ID }));
    expect(response.status).toBe(403);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });
});

describe('POST /api/cases — payment data rejection (Phase 19A)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it.each(['cardNumber', 'cardExp', 'cardExpiration', 'cardCvv', 'cvv', 'cardholderName', 'billingZip'])(
    'rejects a request whose body contains "%s" with 400, before any authorization/write happens',
    async (key) => {
      const response = await POST(postRequest({ ...VALID_CREATE_BODY, [key]: 'forged-value' }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toMatch(new RegExp(key));
      expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    },
  );

  it('rejects a request containing multiple forbidden fields at once, listing all of them', async () => {
    const response = await POST(
      postRequest({ ...VALID_CREATE_BODY, cardNumber: '4111111111111111', cardCvv: '123' }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/cardNumber/);
    expect(body.error).toMatch(/cardCvv/);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('never echoes the forged card value back in the error response', async () => {
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, cardNumber: '4111111111111111' }));
    const bodyText = await response.text();
    expect(bodyText).not.toContain('4111111111111111');
  });

  it('still accepts a legitimate request with fieldValues that contain no forbidden keys', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, fieldValues: { 0: 'Test value' } }));
    expect(response.status).toBe(201);
  });
});

describe('POST /api/cases — validation', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('returns 400 when organizationId is missing from the body', async () => {
    const { organizationId, ...rest } = VALID_CREATE_BODY;
    void organizationId;
    const response = await POST(postRequest(rest));
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const response = await POST(
      new Request('http://localhost/api/cases', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: '{not json' }),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when a required field is missing or empty', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, decedentName: '' }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/decedentName/);
  });

  it('returns 400 when an optional field has the wrong type', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, weight: 123 }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when DATA_ADAPTER is not wix', async () => {
    process.env.DATA_ADAPTER = 'mock';
    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/cases — nextOfKinEmail (Manors launch-prep)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('creates the case without a NOK email — optional, defaults to null', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.nextOfKinEmail).toBeNull();
  });

  it('creates the case with a valid NOK email, trimmed', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, nextOfKinEmail: '  karen@example.com  ' }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.nextOfKinEmail).toBe('karen@example.com');
  });

  it('rejects a malformed NOK email with 400 — never silently drops or coerces it', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, nextOfKinEmail: 'not-an-email' }));
    expect(response.status).toBe(400);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a non-string nextOfKinEmail with 400', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, nextOfKinEmail: 12345 }));
    expect(response.status).toBe(400);
  });

  it('treats an empty string the same as omitting it — no validation error, defaults to null', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, nextOfKinEmail: '   ' }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.nextOfKinEmail).toBeNull();
  });
});

describe('POST /api/cases — nextOfKinRelationship (Manors launch-prep)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('creates the case without a NOK relationship — optional, defaults to null', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.nextOfKinRelationship).toBeNull();
    expect(body.case.nextOfKinRelationshipOther).toBeNull();
  });

  it('creates the case with a valid NOK relationship', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, nextOfKinRelationship: 'daughter' }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.nextOfKinRelationship).toBe('daughter');
  });

  it('creates the case with relationship "other" and a trimmed description', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(
      postRequest({ ...VALID_CREATE_BODY, nextOfKinRelationship: 'other', nextOfKinRelationshipOther: '  family friend  ' }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.nextOfKinRelationship).toBe('other');
    // SOLIS ALL-CAPS data standard (2026-09): normalized on creation.
    expect(body.case.nextOfKinRelationshipOther).toBe('FAMILY FRIEND');
  });

  it('rejects an unrecognized NOK relationship value with 400 — never silently drops or coerces it', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, nextOfKinRelationship: 'cousin-twice-removed' }));
    expect(response.status).toBe(400);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a non-string nextOfKinRelationship with 400', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, nextOfKinRelationship: 42 }));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/cases — Certifier fields (2026-09, ADR-041)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('creates the case without any certifier fields — optional, all default to null', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.certifierName).toBeNull();
    expect(body.case.certifierPhone).toBeNull();
    expect(body.case.certifierLicenseNumber).toBeNull();
    expect(body.case.certifierFax).toBeNull();
  });

  it('creates the case with all four certifier fields, trimmed and normalized', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(
      postRequest({
        ...VALID_CREATE_BODY,
        certifierName: '  dr. jane foster  ',
        certifierPhone: '555-0199',
        certifierLicenseNumber: '  md-4471  ',
        certifierFax: '555-0188',
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    // SOLIS ALL-CAPS data standard (2026-09): certifierName/
    // certifierLicenseNumber are name/code fields, normalized on creation;
    // certifierPhone/certifierFax are excluded, matching nextOfKinPhone.
    expect(body.case.certifierName).toBe('DR. JANE FOSTER');
    expect(body.case.certifierPhone).toBe('555-0199');
    expect(body.case.certifierLicenseNumber).toBe('MD-4471');
    expect(body.case.certifierFax).toBe('555-0188');
  });

  it('an empty string for any certifier field is treated as omitted (null), not an empty string', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, certifierName: '   ' }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.certifierName).toBeNull();
  });

  it('rejects a non-string certifier field with 400 — never silently drops or coerces it', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, certifierPhone: 12345 }));
    expect(response.status).toBe(400);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });
});

describe('POST /api/cases — returnMethod (conditional shipping/tracking, 2026-09)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('creates the case defaulting to returnMethod "undecided" when not provided — a family has not necessarily decided at intake', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.returnMethod).toBe('undecided');
    expect(body.case.shippingCarrier).toBeNull();
    expect(body.case.shippingTrackingNumber).toBeNull();
  });

  it('creates the case with returnMethod "shipping" selected at intake, with zero shipping details required', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, returnMethod: 'shipping' }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.returnMethod).toBe('shipping');
    expect(body.case.shippingCarrier).toBeNull();
    expect(body.case.shippingTrackingNumber).toBeNull();
    expect(body.case.shippingDateShipped).toBeNull();
  });

  it('creates the case with returnMethod "pickup" selected at intake', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, returnMethod: 'pickup' }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.returnMethod).toBe('pickup');
  });

  it('rejects an unrecognized returnMethod value with 400 — never silently drops or coerces it', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, returnMethod: 'carrier-pigeon' }));
    expect(response.status).toBe(400);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('there is no request-body field for shipping carrier/tracking number/date shipped at creation at all', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );
    // Even if a caller forges these fields into the request body, POST
    // /api/cases has no code path that reads them off `b` at all — buildWixCaseData
    // is never passed them, so they can never reach the created case.
    const response = await POST(
      postRequest({ ...VALID_CREATE_BODY, returnMethod: 'shipping', shippingCarrier: 'USPS', shippingTrackingNumber: '9400111899223197428019' }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.case.shippingCarrier).toBeNull();
    expect(body.case.shippingTrackingNumber).toBeNull();
  });
});

describe('POST /api/cases — creation', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('resolves the organization\'s enabled workflow template server-side and creates the case', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    // SOLIS ALL-CAPS data standard (2026-09): normalized on creation.
    expect(body.case.decedentName).toBe('TEST DECEDENT');
    expect(body.case.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(body.case.workflowTemplateId).toBe('workflow-template-standard-cremation');
    expect(body.case.rawStage).toBe(0);
    expect(body.case.isDeleted).toBe(false);
  });

  it('Phase 24: records a case.created activity event with a compact identifying snapshot, never the full case', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();
    expect(response.status).toBe(201);

    const activityCall = mockInsertWixDataItem.mock.calls.find((call) => call[0] === 'activityEvents');
    expect(activityCall).toBeTruthy();
    const eventData = activityCall![1] as Record<string, unknown>;
    expect(eventData.eventType).toBe('case.created');
    expect(eventData.category).toBe('cases');
    expect(eventData.resourceId).toBe(body.case.id);
    expect(eventData.previousValue).toBeNull();
    const snapshot = JSON.parse(eventData.newValue as string);
    expect(Object.keys(snapshot).sort()).toEqual(['caseNumber', 'decedentName']); // compact, not the full case
  });

  it("Phase 24: an activity-recording failure never fails the actual case creation", async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((collectionId: string, data: Record<string, unknown>, itemId: string) => {
      if (collectionId === 'activityEvents') return Promise.reject(new Error('activityEvents collection unavailable'));
      return Promise.resolve({ id: itemId, dataCollectionId: collectionId, data: { ...data, beaconCaseId: itemId } });
    });

    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(201);
  });

  it('sets the Wix item id to the generated beaconCaseId at insert time', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    await POST(postRequest(VALID_CREATE_BODY));

    const [collectionId, , itemId] = mockInsertWixDataItem.mock.calls[0];
    expect(collectionId).toBe('cases');
    expect(typeof itemId).toBe('string');
    expect(itemId.length).toBeGreaterThan(0);
  });

  it('returns 500 "Failed to create case." with a specific server-side diagnostic log when the inserted item fails to round-trip (Solis go-live diagnostics)', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      // Simulates a malformed round-trip — currentStage comes back as a
      // string, so mapWixCaseItem fails closed and returns null.
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId, currentStage: '0' } }),
    );
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to create case.'); // client-visible message stays generic
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('mapWixCaseItem returned null'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('currentStage: expected number, got string'));
    consoleErrorSpy.mockRestore();
  });

  it('never trusts a client-supplied workflowTemplateId — ignores it and resolves the template independently', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(
      postRequest({ ...VALID_CREATE_BODY, workflowTemplateId: 'forged-template-id', workflowSnapshot: { stages: [] } }),
    );
    const body = await response.json();

    expect(body.case.workflowTemplateId).toBe('workflow-template-standard-cremation');
  });

  it('returns 422 when the organization has no enabled workflow template', async () => {
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
      return Promise.resolve({ dataItems: [] });
    });
    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(422);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('reserves the Case Number server-side via reserveNextCaseNumber for the authorized organization and the current (UTC-fallback) year', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    // mockGetOrganization resolves null by default (no org record) — orgLocalYear
    // falls back to UTC, matching this test's own use of orgLocalYear(now, undefined).
    const [, yearArg] = mockReserveNextCaseNumber.mock.calls[0];
    expect(yearArg).toBe(orgLocalYear(new Date().toISOString(), undefined));
    expect(body.case.caseNumber).toBe('B2026-001');
  });

  describe('Manors launch-prep — P0: case-number year uses the organization\'s LOCAL timezone, never blind UTC', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does NOT roll the case number to the new year just because UTC already has', async () => {
      mockEnabledTemplate();
      mockGetOrganization.mockResolvedValue({ id: DEFAULT_ORGANIZATION_ID, name: 'Manor\'s Cremation', isActive: true, timezone: 'America/New_York' });
      mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
      );
      // 2027-01-01T04:30:00Z is already Jan 1 UTC, but 2026-12-31 23:30 in
      // America/New_York (UTC-5 in winter) — must still reserve for 2026.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2027-01-01T04:30:00.000Z'));

      await POST(postRequest(VALID_CREATE_BODY));

      expect(mockReserveNextCaseNumber).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 2026);
    });

    it('rolls the case number to the new year before UTC does, for a timezone ahead of UTC', async () => {
      mockEnabledTemplate();
      mockGetOrganization.mockResolvedValue({ id: DEFAULT_ORGANIZATION_ID, name: 'Test Org', isActive: true, timezone: 'Asia/Tokyo' });
      mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
      );
      // 2026-12-31T20:00:00Z is still Dec 31 in UTC, but already
      // 2027-01-01 05:00 in Asia/Tokyo (UTC+9) — must reserve for 2027.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-12-31T20:00:00.000Z'));

      await POST(postRequest(VALID_CREATE_BODY));

      expect(mockReserveNextCaseNumber).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 2027);
    });
  });

  it('never trusts a client-supplied caseNumber — the request body value is ignored entirely', async () => {
    mockEnabledTemplate();
    mockReserveNextCaseNumber.mockResolvedValue('B2026-042');
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, caseNumber: 'B2026-999' }));
    const body = await response.json();

    expect(body.case.caseNumber).toBe('B2026-042');
  });

  it('propagates a Case Number reservation failure as a 503 without leaking internal details', async () => {
    mockEnabledTemplate();
    mockReserveNextCaseNumber.mockRejectedValue(new Error('Wix Data increment failed for collection "caseSequences" (HTTP 500).'));

    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).not.toMatch(/test-key/);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('propagates a Wix write failure as a 503 without leaking internal details', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockRejectedValue(new Error('Wix Data insert failed for collection "cases" (HTTP 500).'));

    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).not.toMatch(/test-key/);
  });
});

describe('POST /api/cases — Task #15 (2026-09, future-historical-date validation)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  const farFutureDate = `01/01/${new Date().getFullYear() + 5}`;

  it('rejects a future Date of Birth with 400, before any workflow-template lookup or write', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, dateOfBirth: farFutureDate }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Date of Birth cannot be in the future.');
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a future Date of Death with 400', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, dateOfDeath: farFutureDate }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Date of Death cannot be in the future.');
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('looks up the organization\'s own timezone to resolve "today" when a date field is present (resolveOrgLocalToday, same authoritative source as case-number year rollover — see utils/inputMask.test.ts for the org-local-vs-UTC correctness proof itself)', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );
    mockGetOrganization = vi.fn().mockResolvedValue({ timezone: 'America/New_York' });

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, dateOfDeath: '01/05/2020' }));

    expect(response.status).toBe(201);
    expect(mockGetOrganization).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'wix');
  });

  it('does not fetch the organization at all when neither date field is present in the request', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    await POST(postRequest(VALID_CREATE_BODY));

    // The route still fetches organization once for case-number year
    // rollover (orgLocalYear) — this asserts no *extra*, redundant fetch
    // happens for date validation when there's nothing to validate.
    expect(mockGetOrganization).toHaveBeenCalledTimes(1);
  });

  it('a valid past Date of Birth/Date of Death still creates the case', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, dateOfBirth: '01/05/1950', dateOfDeath: '07/09/2026' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.dateOfBirth).toBe('01/05/1950');
    expect(body.case.dateOfDeath).toBe('07/09/2026');
  });
});

describe('POST /api/cases — historical case-number authorization (2026-09)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  it('U: a valid historical authorization skips reserveNextCaseNumber and uses the preserved number', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );
    const token = await createHistoricalCaseNumberAuthorization({
      organizationId: DEFAULT_ORGANIZATION_ID,
      externalFormId: '261945978664175',
      externalSubmissionId: 'sub-synthetic-1',
      caseNumber: 'B2026-035',
    });

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, historicalCaseNumberAuthorization: token }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.caseNumber).toBe('B2026-035');
    expect(mockReserveNextCaseNumber).not.toHaveBeenCalled();
  });

  /**
   * Historical-import sequence safety (2026-10). Because the preserved
   * number bypasses reserveNextCaseNumber entirely, the counter is left
   * untouched and can end up BEHIND an imported number — the next
   * normally-allocated case would then be handed a number that already
   * exists. Observed live: importing B2026-036 left nextSequence at 36.
   */
  it('advances the case-number sequence past the preserved historical number', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );
    const token = await createHistoricalCaseNumberAuthorization({
      organizationId: DEFAULT_ORGANIZATION_ID,
      externalFormId: '261945978664175',
      externalSubmissionId: 'sub-synthetic-1',
      caseNumber: 'B2026-036',
    });

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, historicalCaseNumberAuthorization: token }));

    expect(response.status).toBe(201);
    // Year and sequence are taken from the preserved number itself, not
    // from the server clock or the organization's local year.
    expect(mockAdvanceCaseSequencePast).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 2026, 36);
  });

  it('never advances the sequence on the normal (non-historical) creation path', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );

    const response = await POST(postRequest(VALID_CREATE_BODY));

    expect(response.status).toBe(201);
    expect(mockReserveNextCaseNumber).toHaveBeenCalled();
    expect(mockAdvanceCaseSequencePast).not.toHaveBeenCalled();
  });

  it('still creates the case when advancing the sequence fails — the insert already succeeded', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );
    mockAdvanceCaseSequencePast.mockRejectedValue(new Error('Wix Data update failed for collection "caseSequences" (HTTP 500).'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = await createHistoricalCaseNumberAuthorization({
      organizationId: DEFAULT_ORGANIZATION_ID,
      externalFormId: '261945978664175',
      externalSubmissionId: 'sub-synthetic-1',
      caseNumber: 'B2026-036',
    });

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, historicalCaseNumberAuthorization: token }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.caseNumber).toBe('B2026-036');
    // Logged loudly so the lag is traceable; repairable from
    // Settings > Case Numbering's resync action.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to advance the case-number sequence'), expect.anything());
    errorSpy.mockRestore();
  });

  it('rejects an invalid/malformed authorization and never falls back to normal allocation', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, historicalCaseNumberAuthorization: 'not-a-real-token' }));
    expect(response.status).toBe(403);
    expect(mockReserveNextCaseNumber).not.toHaveBeenCalled();
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects an authorization minted for a different organization', async () => {
    mockEnabledTemplate();
    const token = await createHistoricalCaseNumberAuthorization({
      organizationId: 'a-different-org',
      externalFormId: '261945978664175',
      externalSubmissionId: 'sub-synthetic-1',
      caseNumber: 'B2026-035',
    });
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, historicalCaseNumberAuthorization: token }));
    expect(response.status).toBe(403);
    expect(mockReserveNextCaseNumber).not.toHaveBeenCalled();
  });

  it('rejects an expired authorization', async () => {
    mockEnabledTemplate();
    const now = 1_800_000_000;
    const token = await createHistoricalCaseNumberAuthorization(
      { organizationId: DEFAULT_ORGANIZATION_ID, externalFormId: '261945978664175', externalSubmissionId: 'sub-synthetic-1', caseNumber: 'B2026-035' },
      now,
    );
    vi.spyOn(Date, 'now').mockReturnValue((now + 10 * 60) * 1000); // 10 minutes later, past the 5-min window
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, historicalCaseNumberAuthorization: token }));
    expect(response.status).toBe(403);
    vi.restoreAllMocks();
  });

  it('N: rejects when a Case already exists with the preserved historical number, never creating a duplicate', async () => {
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'workflowTemplates') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_ITEM] });
      if (collectionId === 'workflowTemplateVersions') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_VERSION_ITEM] });
      if (collectionId === 'staffProfiles') return Promise.resolve({ dataItems: [CALLER_STAFF_PROFILE_ITEM] });
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
      if (collectionId === 'cases') {
        return Promise.resolve({
          dataItems: [{ id: 'existing-case-1', dataCollectionId: 'cases', data: { organizationId: DEFAULT_ORGANIZATION_ID, caseNumber: 'B2026-035' } }],
        });
      }
      return Promise.resolve({ dataItems: [] });
    });
    const token = await createHistoricalCaseNumberAuthorization({
      organizationId: DEFAULT_ORGANIZATION_ID,
      externalFormId: '261945978664175',
      externalSubmissionId: 'sub-synthetic-1',
      caseNumber: 'B2026-035',
    });

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, historicalCaseNumberAuthorization: token }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.historicalDuplicate).toBe(true);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('V: normal creation (no historical authorization) still calls reserveNextCaseNumber, unchanged', async () => {
    mockEnabledTemplate();
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );
    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(201);
    expect(mockReserveNextCaseNumber).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-string historicalCaseNumberAuthorization body field', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, historicalCaseNumberAuthorization: 12345 }));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/cases — Phase 30 (Identity Model Hardening & Staff Assignment Unification)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );
  });

  it('resolves createdBy/intakeOwnerId from the caller\'s own StaffProfile, ignoring any client-supplied value', async () => {
    mockEnabledTemplate();
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, createdBy: 'forged-staff-id', intakeOwnerId: 'forged-staff-id' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.createdBy).toBe('staff-dana');
    expect(body.case.intakeOwnerId).toBe('staff-dana');
  });

  it('returns 422 when the caller has no linked StaffProfile in this organization, with a specific message and server-side diagnostic log (Solis go-live: confirmed root cause of "Failed to create case.")', async () => {
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'workflowTemplates') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_ITEM] });
      if (collectionId === 'workflowTemplateVersions') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_VERSION_ITEM] });
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
      return Promise.resolve({ dataItems: [] }); // no staffProfiles row for this caller
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('No StaffProfile is linked to your account in this organization.');
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    // The specific, already-safe-to-display reason must be traceable
    // server-side too — this is the exact branch that a real production
    // "Failed to create case." report traced back to (see
    // services/casesService.ts's error-surfacing fix).
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No StaffProfile linked'));
    consoleErrorSpy.mockRestore();
  });

  it('accepts an explicit assignedStaffId naming another active, in-organization staff profile', async () => {
    const OTHER_STAFF_PROFILE_ITEM = {
      id: 'staff-chris',
      dataCollectionId: 'staffProfiles',
      data: {
        beaconStaffProfileId: 'staff-chris',
        organizationId: DEFAULT_ORGANIZATION_ID,
        identityId: 'identity-manors-chris',
        membershipId: null,
        displayName: 'Chris',
        role: 'funeral_director',
        isActive: true,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    };
    mockCasesRoutesWithStaffProfiles([CALLER_STAFF_PROFILE_ITEM, OTHER_STAFF_PROFILE_ITEM]);

    const response = await POST(postRequest({ ...VALID_CREATE_BODY, assignedStaffId: 'staff-chris' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.assignedStaffId).toBe('staff-chris');
  });

  it('rejects an explicit assignedStaffId naming a nonexistent staff profile, with 422, before any write', async () => {
    mockCasesRoutesWithStaffProfiles([CALLER_STAFF_PROFILE_ITEM]);
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, assignedStaffId: 'staff-does-not-exist' }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/staff-does-not-exist/);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });
});

// Manors go-live fix (real session identity + case assignment
// authorization). Mirrors [caseId]/route.test.ts's own Dispatch describe
// block pattern exactly: a role fixture's 'roles'/'rolePermissions' mock
// resolves to a fixed role regardless of the requested key, so
// mockSession's own role string never needs to change per test.
describe('POST /api/cases — role-based authorization (Manors go-live fix: case.create / case.reassign)', () => {
  const OTHER_STAFF_PROFILE_ITEM = {
    id: 'staff-chris',
    dataCollectionId: 'staffProfiles',
    data: {
      beaconStaffProfileId: 'staff-chris',
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId: 'identity-manors-chris',
      membershipId: null,
      displayName: 'Chris',
      role: 'funeral_director',
      isActive: true,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
    },
  };

  function roleFixture(key: string, permissions: string[]) {
    const roleItem = {
      id: `role-${key}`,
      dataCollectionId: 'roles',
      data: {
        beaconRoleId: `role-${key}`,
        key,
        name: key,
        description: '',
        organizationId: null,
        isSystemDefault: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const permissionItems = permissions.map((permissionKey) => ({
      id: `role-permission-${key}-${permissionKey}`,
      dataCollectionId: 'rolePermissions',
      data: { beaconRolePermissionId: `role-permission-${key}-${permissionKey}`, roleId: `role-${key}`, permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
    }));
    return { roleItem, permissionItems };
  }

  function mockRoleAndStaffProfiles(roleKey: string, permissions: string[], profileItems: typeof CALLER_STAFF_PROFILE_ITEM[]) {
    const { roleItem, permissionItems } = roleFixture(roleKey, permissions);
    mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
      if (collectionId === 'workflowTemplates') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_ITEM] });
      if (collectionId === 'workflowTemplateVersions') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_VERSION_ITEM] });
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [roleItem] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: permissionItems });
      if (collectionId === 'staffProfiles') {
        const filter = options?.filter ?? {};
        const matches = profileItems.filter(
          (item) =>
            (filter.identityId === undefined || item.data.identityId === filter.identityId) &&
            (filter.beaconStaffProfileId === undefined || item.data.beaconStaffProfileId === filter.beaconStaffProfileId) &&
            (filter.organizationId === undefined || item.data.organizationId === filter.organizationId),
        );
        return Promise.resolve({ dataItems: matches });
      }
      return Promise.resolve({ dataItems: [] });
    });
  }

  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data: { ...data, beaconCaseId: itemId } }),
    );
  });

  it('Manors case.create policy (authoritative, 2026-09 correction): Dispatch (pickup.read/pickup.update only) cannot create a case', async () => {
    mockRoleAndStaffProfiles('dispatch', ['pickup.read', 'pickup.update'], [CALLER_STAFF_PROFILE_ITEM]);
    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    expect(body.case).toBeNull();
  });

  it('Manors case.create policy (authoritative, 2026-09 correction): Read Only (case.read only) cannot create a case', async () => {
    mockRoleAndStaffProfiles('readOnly', ['case.read'], [CALLER_STAFF_PROFILE_ITEM]);
    const response = await POST(postRequest(VALID_CREATE_BODY));

    expect(response.status).toBe(403);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('Manors case.create policy (authoritative, 2026-09 correction): Accounting (case.read only, no case.create) cannot create a case', async () => {
    mockRoleAndStaffProfiles('accounting', ['case.read', 'payment.read', 'payment.collect'], [CALLER_STAFF_PROFILE_ITEM]);
    const response = await POST(postRequest(VALID_CREATE_BODY));

    expect(response.status).toBe(403);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('Manors case.create policy (authoritative, 2026-09 correction): Funeral Director (case.create + case.update) can create a case', async () => {
    mockRoleAndStaffProfiles('funeralDirector', ['case.create', 'case.update'], [CALLER_STAFF_PROFILE_ITEM]);
    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.assignedStaffId).toBe('staff-dana');
  });

  it('Office Staff (case.create + case.update, no case.reassign) can create a case defaulting to themselves', async () => {
    mockRoleAndStaffProfiles('officeStaff', ['case.create', 'case.update'], [CALLER_STAFF_PROFILE_ITEM]);
    const response = await POST(postRequest(VALID_CREATE_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.assignedStaffId).toBe('staff-dana');
  });

  it('Office Staff (no case.reassign) cannot create a case assigned to a different staff member', async () => {
    mockRoleAndStaffProfiles('officeStaff', ['case.create', 'case.update'], [CALLER_STAFF_PROFILE_ITEM, OTHER_STAFF_PROFILE_ITEM]);
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, assignedStaffId: 'staff-chris' }));

    expect(response.status).toBe(422);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('Manager (case.create + case.reassign) can create a case assigned to a different staff member', async () => {
    mockRoleAndStaffProfiles('manager', ['case.create', 'case.reassign'], [CALLER_STAFF_PROFILE_ITEM, OTHER_STAFF_PROFILE_ITEM]);
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, assignedStaffId: 'staff-chris' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.assignedStaffId).toBe('staff-chris');
  });
});

/**
 * Case list scalability, Phase 2 (2026-09). Stage filtering + server-side
 * search, wix mode. Unlike Phase 1's `mockPagedCasesListQuery` (which
 * simply slices a pre-arranged array), this mock actually INTERPRETS the
 * `filter` object the route builds (`buildCaseListWixFilter`/
 * `buildCaseSearchWixFilter`) against each item's raw Wix-shaped data —
 * proving the route pushes `stage`/`searchQuery` into the Wix QUERY
 * itself (matched before pagination), not a post-fetch filter over
 * whatever page happened to come back. Uses the real Wix field names
 * (`currentStage`, `beaconCaseId`) — the exact bug this suite is designed
 * to catch if the route ever regresses to the wrong (domain-level) names.
 */
describe('GET /api/cases — stage filtering + server-side search (Case list scalability, Phase 2), wix mode', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  function caseItem(overrides: {
    id: string;
    caseNumber: string;
    createdAt: string;
    currentStage?: number;
    decedentName?: string;
    organizationId?: string;
  }) {
    return {
      id: overrides.id,
      dataCollectionId: 'cases',
      data: {
        beaconCaseId: overrides.id,
        organizationId: overrides.organizationId ?? DEFAULT_ORGANIZATION_ID,
        caseNumber: overrides.caseNumber,
        caseType: 'cremation',
        workflowTemplateId: 'workflow-template-standard-cremation',
        workflowTemplateVersion: 1,
        workflowSnapshot: {
          workflowTemplateId: 'workflow-template-standard-cremation',
          workflowTemplateVersion: 1,
          stages: [],
          intake: { sections: [] },
        },
        intakeOwnerId: 'staff-dana',
        caseHandlerId: 'staff-dana',
        currentStage: overrides.currentStage ?? 0,
        checklistState: {},
        fieldValues: {},
        decedentName: overrides.decedentName ?? `Decedent ${overrides.id}`,
        dateOfBirth: '01/01/2000',
        dateOfDeath: '01/01/2026',
        timeOfDeath: '00:00',
        placeOfDeath: 'Test Hospital',
        weight: '150 lb',
        nextOfKinName: 'Test NOK',
        nextOfKinPhone: '555-0000',
        nextOfKinEmail: null,
        tagNumber: null,
        paymentStatus: 'awaiting_payment',
        isVeteran: false,
        isArchived: false,
        createdAt: overrides.createdAt,
      },
    };
  }

  function matchesWixFilterValue(actual: unknown, condition: unknown): boolean {
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      const ops = condition as Record<string, unknown>;
      if ('$eq' in ops) return actual === ops.$eq;
      if ('$in' in ops) return Array.isArray(ops.$in) && (ops.$in as unknown[]).includes(actual);
      if ('$startsWith' in ops) {
        return (
          typeof actual === 'string' &&
          typeof ops.$startsWith === 'string' &&
          actual.toLowerCase().startsWith((ops.$startsWith as string).toLowerCase())
        );
      }
      throw new Error(`Unrecognized filter operator: ${JSON.stringify(ops)}`);
    }
    return actual === condition;
  }

  function matchesWixFilter(data: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    if ('$and' in filter) return (filter.$and as Record<string, unknown>[]).every((f) => matchesWixFilter(data, f));
    if ('$or' in filter) return (filter.$or as Record<string, unknown>[]).some((f) => matchesWixFilter(data, f));
    return Object.entries(filter).every(([key, condition]) => matchesWixFilterValue(data[key], condition));
  }

  /** A "real collection" simulator — the query it receives is actually
      applied against `allCaseItems` (organization scope + isArchived +
      currentStage + search, exactly as Wix's own filter engine would),
      THEN paginated. This is what makes "500 total, 12 matching" tests
      meaningful: the mock can't be fooled by a route that fetches an
      arbitrary page and filters afterward, because there IS no
      unfiltered page to fetch — filtering always happens first. */
  function mockWixCasesCollection(allCaseItems: ReturnType<typeof caseItem>[]) {
    let pageSize = 0;
    mockQueryWixDataItems.mockImplementation(
      (collectionId: string, options?: { filter?: Record<string, unknown>; paging?: { limit?: number; cursor?: string } }) => {
        if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
        if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
        if (collectionId !== 'cases') return Promise.resolve({ dataItems: [] });

        const filter = options?.filter ?? {};
        const matched = allCaseItems.filter((item) => matchesWixFilter(item.data, filter));

        if (!options?.paging) {
          return Promise.resolve({ dataItems: matched, pagingMetadata: { hasNext: false, cursors: { next: null } } });
        }

        const { limit, cursor } = options.paging;
        let offset = 0;
        if (typeof limit === 'number') pageSize = limit;
        else if (typeof cursor === 'string') offset = Number(cursor);
        const slice = matched.slice(offset, offset + pageSize);
        const nextOffset = offset + slice.length;
        const hasNext = nextOffset < matched.length;
        return Promise.resolve({
          dataItems: slice,
          pagingMetadata: { hasNext, cursors: { next: hasNext ? String(nextOffset) : null } },
        });
      },
    );
  }

  function requestWith(organizationId: string, params: Record<string, string>) {
    const search = new URLSearchParams({ organizationId, ...params });
    return new Request(`http://localhost/api/cases?${search.toString()}`);
  }

  describe('stage filtering', () => {
    it('1/2. a valid stage returns only that stage\'s cases — 500-total/12-matching shape: the query matches only the 12, never fetching an arbitrary page and filtering afterward', () => {
      const firstCall = Array.from({ length: 12 }, (_, i) => caseItem({ id: `fc-${i}`, caseNumber: `B2026-${100 + i}`, createdAt: '2026-01-01T00:00:00.000Z', currentStage: 0 }));
      const otherStages = Array.from({ length: 488 }, (_, i) => caseItem({ id: `other-${i}`, caseNumber: `B2026-${200 + i}`, createdAt: '2026-01-01T00:00:00.000Z', currentStage: 3 }));
      mockWixCasesCollection([...firstCall, ...otherStages]);

      return (async () => {
        const body = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'First Call & Payment', limit: '50' }))).json();
        expect(body.cases).toHaveLength(12);
        expect(body.cases.every((c: { id: string }) => c.id.startsWith('fc-'))).toBe(true);
        expect(body.hasMore).toBe(false);
      })();
    });

    it('confirms the query filter itself carries the stage constraint (currentStage $in), not a post-fetch check', async () => {
      mockWixCasesCollection([caseItem({ id: 'c1', caseNumber: 'B2026-001', createdAt: '2026-01-01T00:00:00.000Z', currentStage: 7 })]);
      await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', limit: '10' }));

      expect(mockQueryWixDataItems).toHaveBeenCalledWith(
        'cases',
        expect.objectContaining({ filter: expect.objectContaining({ currentStage: { $in: [7] } }) }),
      );
    });

    it('"First Call & Payment" resolves to currentStage $in [0, 1] — the one combined display stage', async () => {
      mockWixCasesCollection([]);
      await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'First Call & Payment', limit: '10' }));

      expect(mockQueryWixDataItems).toHaveBeenCalledWith(
        'cases',
        expect.objectContaining({ filter: expect.objectContaining({ currentStage: { $in: [0, 1] } }) }),
      );
    });

    it('3. an invalid stage returns 400, never silently behaving as All Cases', async () => {
      mockWixCasesCollection([caseItem({ id: 'c1', caseNumber: 'B2026-001', createdAt: '2026-01-01T00:00:00.000Z' })]);
      const response = await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Pending Approval', limit: '10' }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.cases).toEqual([]);
      expect(mockQueryWixDataItems).not.toHaveBeenCalled();
    });

    it('4. no stage param at all returns All Cases behavior (every stage represented)', async () => {
      mockWixCasesCollection([
        caseItem({ id: 'c1', caseNumber: 'B2026-001', createdAt: '2026-01-01T00:00:00.000Z', currentStage: 0 }),
        caseItem({ id: 'c2', caseNumber: 'B2026-002', createdAt: '2026-01-02T00:00:00.000Z', currentStage: 7 }),
      ]);
      const body = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { limit: '10' }))).json();
      expect(body.cases.map((c: { id: string }) => c.id).sort()).toEqual(['c1', 'c2']);
    });

    it('5/6. stage + pagination works across multiple pages with no duplicates or skips', async () => {
      const items = Array.from({ length: 5 }, (_, i) => caseItem({ id: `s-${5 - i}`, caseNumber: `B2026-${100 + (5 - i)}`, createdAt: `2026-0${5 - i}-01T00:00:00.000Z`, currentStage: 7 }));
      mockWixCasesCollection(items);

      const page1 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', limit: '2' }))).json();
      const page2 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', limit: '2', cursor: page1.nextCursor }))).json();
      const page3 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', limit: '2', cursor: page2.nextCursor }))).json();

      const allIds = [...page1.cases, ...page2.cases, ...page3.cases].map((c: { id: string }) => c.id);
      expect(allIds).toEqual(['s-5', 's-4', 's-3', 's-2', 's-1']);
      expect(new Set(allIds).size).toBe(5);
      expect(page3.hasMore).toBe(false);
    });

    it('7. a cursor minted for one stage cannot be reused for another', async () => {
      mockWixCasesCollection([
        caseItem({ id: 'c1', caseNumber: 'B2026-001', createdAt: '2026-01-01T00:00:00.000Z', currentStage: 7 }),
        caseItem({ id: 'c2', caseNumber: 'B2026-002', createdAt: '2026-01-02T00:00:00.000Z', currentStage: 0 }),
      ]);
      const page1 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', limit: '1' }))).json();
      // Force a cursor to exist even though this tiny fixture set has only
      // one Completed case, by re-minting one directly against a larger
      // synthetic Completed set, then attempting to reuse it under a
      // DIFFERENT stage param.
      void page1;
      const items = Array.from({ length: 3 }, (_, i) => caseItem({ id: `cc-${i}`, caseNumber: `B2026-${300 + i}`, createdAt: '2026-01-01T00:00:00.000Z', currentStage: 7 }));
      mockWixCasesCollection(items);
      const completedPage1 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', limit: '1' }))).json();
      expect(typeof completedPage1.nextCursor).toBe('string');

      const response = await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'First Call & Payment', limit: '1', cursor: completedPage1.nextCursor }));
      expect(response.status).toBe(400);
    });

    it('8. deleted/archived cases remain excluded when a stage filter is applied', async () => {
      mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
        if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
        if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
        if (collectionId !== 'cases') return Promise.resolve({ dataItems: [] });
        expect(options?.filter).toMatchObject({ isArchived: false });
        return Promise.resolve({ dataItems: [], pagingMetadata: { hasNext: false, cursors: { next: null } } });
      });
      await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', limit: '10' }));
      expect(mockQueryWixDataItems).toHaveBeenCalled();
    });

    it('9. organization isolation remains enforced when a stage filter is applied', async () => {
      mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
        if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
        if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
        if (collectionId !== 'cases') return Promise.resolve({ dataItems: [] });
        expect(options?.filter).toMatchObject({ organizationId: DEFAULT_ORGANIZATION_ID });
        return Promise.resolve({ dataItems: [], pagingMetadata: { hasNext: false, cursors: { next: null } } });
      });
      await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', limit: '10' }));
      expect(mockQueryWixDataItems).toHaveBeenCalled();
    });
  });

  describe('server-side search', () => {
    it('1/2/3. search operates across the complete eligible dataset, not just a fetched page — pagination + search compose correctly', async () => {
      const items = [
        caseItem({ id: 'm1', caseNumber: 'B2026-001', createdAt: '2026-03-01T00:00:00.000Z', decedentName: 'MORALES FAMILY A' }),
        caseItem({ id: 'other', caseNumber: 'B2026-002', createdAt: '2026-02-01T00:00:00.000Z', decedentName: 'SMITH FAMILY' }),
        caseItem({ id: 'm2', caseNumber: 'B2026-003', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY B' }),
      ];
      mockWixCasesCollection(items);

      const page1 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: 'morales', limit: '1' }))).json();
      expect(page1.cases).toHaveLength(1);
      expect(page1.cases[0].id).toBe('m1');
      expect(page1.hasMore).toBe(true);

      const page2 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: 'morales', limit: '1', cursor: page1.nextCursor }))).json();
      expect(page2.cases).toHaveLength(1);
      expect(page2.cases[0].id).toBe('m2');
      expect(page2.hasMore).toBe(false);
    });

    it('4/5. search + stage, and search + stage + pagination, all compose correctly', async () => {
      const items = [
        caseItem({ id: 'match', caseNumber: 'B2026-001', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', currentStage: 6 }),
        caseItem({ id: 'wrong-stage', caseNumber: 'B2026-002', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES OTHER', currentStage: 0 }),
        caseItem({ id: 'wrong-name', caseNumber: 'B2026-003', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'SMITH FAMILY', currentStage: 6 }),
      ];
      mockWixCasesCollection(items);

      const body = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Ready for Pickup / Contact Family', searchQuery: 'morales', limit: '10' }))).json();
      expect(body.cases.map((c: { id: string }) => c.id)).toEqual(['match']);
    });

    it('6. search remains organization-scoped', async () => {
      mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
        if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
        if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
        if (collectionId !== 'cases') return Promise.resolve({ dataItems: [] });
        const filter = options?.filter as { $and?: Record<string, unknown>[] } | undefined;
        expect(filter?.$and?.[0]).toMatchObject({ organizationId: DEFAULT_ORGANIZATION_ID });
        return Promise.resolve({ dataItems: [], pagingMetadata: { hasNext: false, cursors: { next: null } } });
      });
      await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: 'morales', limit: '10' }));
      expect(mockQueryWixDataItems).toHaveBeenCalled();
    });

    it('7. search excludes deleted/archived cases', async () => {
      mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
        if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
        if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
        if (collectionId !== 'cases') return Promise.resolve({ dataItems: [] });
        const filter = options?.filter as { $and?: Record<string, unknown>[] } | undefined;
        expect(filter?.$and?.[0]).toMatchObject({ isArchived: false });
        return Promise.resolve({ dataItems: [], pagingMetadata: { hasNext: false, cursors: { next: null } } });
      });
      await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: 'morales', limit: '10' }));
      expect(mockQueryWixDataItems).toHaveBeenCalled();
    });

    it('8. case-insensitive search: an uppercase query matches a lowercase-stored value and vice versa', async () => {
      mockWixCasesCollection([caseItem({ id: 'c1', caseNumber: 'B2026-001', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'morales family' })]);
      const body = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: 'MORALES', limit: '10' }))).json();
      expect(body.cases).toHaveLength(1);
    });

    it('9. whitespace around the query is trimmed before it reaches the filter', async () => {
      mockWixCasesCollection([caseItem({ id: 'c1', caseNumber: 'B2026-001', createdAt: '2026-01-01T00:00:00.000Z' })]);
      await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: '  B2026-001  ', limit: '10' }));

      expect(mockQueryWixDataItems).toHaveBeenCalledWith(
        'cases',
        expect.objectContaining({
          filter: expect.objectContaining({
            $and: expect.arrayContaining([expect.objectContaining({ $or: expect.arrayContaining([{ caseNumber: { $startsWith: 'B2026-001' } }]) })]),
          }),
        }),
      );
    });

    it('10. every existing searchable field remains searchable (decedentName, caseNumber, nextOfKinPhone, nextOfKinEmail, tagNumber, id -> beaconCaseId)', async () => {
      mockWixCasesCollection([caseItem({ id: 'c1', caseNumber: 'B2026-001', createdAt: '2026-01-01T00:00:00.000Z' })]);
      await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: 'x', limit: '10' }));

      const call = mockQueryWixDataItems.mock.calls.find((c) => c[0] === 'cases' && c[1]?.paging?.limit);
      const filter = call?.[1]?.filter as { $and: Record<string, unknown>[] };
      const orClause = filter.$and[1] as { $or: Record<string, unknown>[] };
      const fieldsSearched = orClause.$or.map((clause) => Object.keys(clause)[0]);
      expect(fieldsSearched.sort()).toEqual(['beaconCaseId', 'caseNumber', 'decedentName', 'nextOfKinEmail', 'nextOfKinPhone', 'tagNumber'].sort());
    });

    it('11. a search cursor cannot be reused with a different search query', async () => {
      const items = Array.from({ length: 3 }, (_, i) => caseItem({ id: `m-${i}`, caseNumber: `B2026-${100 + i}`, createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' }));
      mockWixCasesCollection(items);
      const page1 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: 'morales', limit: '1' }))).json();
      expect(typeof page1.nextCursor).toBe('string');

      const response = await GET(requestWith(DEFAULT_ORGANIZATION_ID, { searchQuery: 'smith', limit: '1', cursor: page1.nextCursor }));
      expect(response.status).toBe(400);
    });

    it('12. a search cursor cannot be reused with a different stage', async () => {
      const items = Array.from({ length: 3 }, (_, i) => caseItem({ id: `m-${i}`, caseNumber: `B2026-${100 + i}`, createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', currentStage: 7 }));
      mockWixCasesCollection(items);
      const page1 = await (await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'Completed', searchQuery: 'morales', limit: '1' }))).json();
      expect(typeof page1.nextCursor).toBe('string');

      const response = await GET(requestWith(DEFAULT_ORGANIZATION_ID, { stage: 'First Call & Payment', searchQuery: 'morales', limit: '1', cursor: page1.nextCursor }));
      expect(response.status).toBe(400);
    });
  });
});

/**
 * Case list scalability, Phase 2 (2026-09). Mock-mode parity for stage
 * filtering + search — same contract, same $startsWith search semantics
 * (never the legacy `.includes()`), proven against a dedicated
 * organization's temporarily-pushed fixtures.
 */
describe('GET /api/cases — stage filtering + server-side search (Case list scalability, Phase 2), mock mode', () => {
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

  function requestWith(organizationId: string, params: Record<string, string>) {
    const search = new URLSearchParams({ organizationId, ...params });
    return new Request(`http://localhost/api/cases?${search.toString()}`);
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

  describe('stage filtering', () => {
    it('1. a valid stage returns only that stage\'s cases', async () => {
      pushMockCase('fc-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 0 });
      pushMockCase('completed-1', { caseNumber: 'B2026-102', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });

      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'Completed', limit: '10' }))).json();
      expect(body.cases.map((c: { id: string }) => c.id)).toEqual(['completed-1']);
    });

    it('"First Call & Payment" matches both raw stage 0 and raw stage 1', async () => {
      pushMockCase('raw-0', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 0 });
      pushMockCase('raw-1', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', rawStage: 1 });

      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'First Call & Payment', limit: '10' }))).json();
      expect(body.cases.map((c: { id: string }) => c.id).sort()).toEqual(['raw-0', 'raw-1']);
    });

    it('3. an invalid stage returns 400', async () => {
      const response = await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'In-House', limit: '10' }));
      expect(response.status).toBe(400);
    });

    it('4. no stage param returns All Cases behavior', async () => {
      pushMockCase('a', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 0 });
      pushMockCase('b', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', rawStage: 7 });

      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { limit: '10' }))).json();
      expect(body.cases.map((c: { id: string }) => c.id).sort()).toEqual(['a', 'b']);
    });

    it('5/6. stage + pagination across multiple pages, no duplicates or skips', async () => {
      pushMockCase('s-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
      pushMockCase('s-2', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', rawStage: 7 });
      pushMockCase('s-3', { caseNumber: 'B2026-103', createdAt: '2026-01-03T00:00:00.000Z', rawStage: 7 });

      const page1 = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'Completed', limit: '2' }))).json();
      const page2 = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'Completed', limit: '2', cursor: page1.nextCursor }))).json();

      const allIds = [...page1.cases, ...page2.cases].map((c: { id: string }) => c.id);
      expect(allIds).toEqual(['s-3', 's-2', 's-1']);
      expect(new Set(allIds).size).toBe(3);
      expect(page2.hasMore).toBe(false);
    });

    it('7. a cursor minted for one stage cannot be reused for another', async () => {
      pushMockCase('s-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
      pushMockCase('s-2', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', rawStage: 7 });
      const page1 = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'Completed', limit: '1' }))).json();
      expect(typeof page1.nextCursor).toBe('string');

      const response = await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'First Call & Payment', limit: '1', cursor: page1.nextCursor }));
      expect(response.status).toBe(400);
    });

    it('8. deleted cases remain excluded when a stage filter is applied', async () => {
      pushMockCase('s-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
      pushMockCase('s-deleted', { caseNumber: 'B2026-199', createdAt: '2026-01-05T00:00:00.000Z', rawStage: 7, isDeleted: true });

      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'Completed', limit: '10' }))).json();
      expect(body.cases.some((c: { id: string }) => c.id === 's-deleted')).toBe(false);
    });

    it('9. organization isolation remains enforced when a stage filter is applied', async () => {
      pushMockCase('s-1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', rawStage: 7 });
      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'Completed', limit: '10' }))).json();
      expect(body.cases.every((c: { organizationId: string }) => c.organizationId === SECOND_MOCK_ORGANIZATION_ID)).toBe(true);
    });
  });

  describe('server-side search', () => {
    it('1/2/3. search operates across the complete eligible dataset with correct pagination', async () => {
      pushMockCase('m1', { caseNumber: 'B2026-101', createdAt: '2026-02-01T00:00:00.000Z', decedentName: 'MORALES FAMILY A' });
      pushMockCase('other', { caseNumber: 'B2026-102', createdAt: '2026-02-02T00:00:00.000Z', decedentName: 'SMITH FAMILY' });
      pushMockCase('m2', { caseNumber: 'B2026-103', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY B' });

      const page1 = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: 'morales', limit: '1' }))).json();
      expect(page1.cases[0].id).toBe('m1');
      expect(page1.hasMore).toBe(true);

      const page2 = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: 'morales', limit: '1', cursor: page1.nextCursor }))).json();
      expect(page2.cases[0].id).toBe('m2');
      expect(page2.hasMore).toBe(false);
    });

    it('4/5. search + stage + pagination compose correctly', async () => {
      pushMockCase('match', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', rawStage: 6 });
      pushMockCase('wrong-stage', { caseNumber: 'B2026-102', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES OTHER', rawStage: 0 });
      pushMockCase('wrong-name', { caseNumber: 'B2026-103', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'SMITH FAMILY', rawStage: 6 });

      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'Ready for Pickup / Contact Family', searchQuery: 'morales', limit: '10' }))).json();
      expect(body.cases.map((c: { id: string }) => c.id)).toEqual(['match']);
    });

    it('6. search remains organization-scoped', async () => {
      pushMockCase('other-org-match', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: 'morales', limit: '10' }))).json();
      expect(body.cases.every((c: { organizationId: string }) => c.organizationId === SECOND_MOCK_ORGANIZATION_ID)).toBe(true);
    });

    it('7. search excludes deleted cases', async () => {
      pushMockCase('m-deleted', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', isDeleted: true });
      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: 'morales', limit: '10' }))).json();
      expect(body.cases).toEqual([]);
    });

    it('8. case-insensitive search', async () => {
      pushMockCase('m1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'morales family' });
      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: 'MORALES', limit: '10' }))).json();
      expect(body.cases).toHaveLength(1);
    });

    it('9. whitespace around the query is trimmed', async () => {
      pushMockCase('m1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
      const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: '  morales  ', limit: '10' }))).json();
      expect(body.cases).toHaveLength(1);
    });

    it('10. every existing searchable field remains searchable in mock mode too', async () => {
      pushMockCase('m1', { caseNumber: 'B2026-999', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'ZZZ', nextOfKinPhone: '555-0000', nextOfKinEmail: 'zzz@example.com', tagNumber: 'T-ZZZ' });
      for (const [query] of [['b2026-999'], ['555-0000'], ['zzz@example'], ['t-zzz'], ['m1']]) {
        const body = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: query, limit: '10' }))).json();
        expect(body.cases.some((c: { id: string }) => c.id === 'm1')).toBe(true);
      }
    });

    it('11. a search cursor cannot be reused with a different search query', async () => {
      pushMockCase('m1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
      pushMockCase('m2', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', decedentName: 'MORALES FAMILY' });
      const page1 = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: 'morales', limit: '1' }))).json();
      expect(typeof page1.nextCursor).toBe('string');

      const response = await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { searchQuery: 'smith', limit: '1', cursor: page1.nextCursor }));
      expect(response.status).toBe(400);
    });

    it('12. a search cursor cannot be reused with a different stage', async () => {
      pushMockCase('m1', { caseNumber: 'B2026-101', createdAt: '2026-01-01T00:00:00.000Z', decedentName: 'MORALES FAMILY', rawStage: 7 });
      pushMockCase('m2', { caseNumber: 'B2026-102', createdAt: '2026-01-02T00:00:00.000Z', decedentName: 'MORALES FAMILY', rawStage: 7 });
      const page1 = await (await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'Completed', searchQuery: 'morales', limit: '1' }))).json();
      expect(typeof page1.nextCursor).toBe('string');

      const response = await GET(requestWith(SECOND_MOCK_ORGANIZATION_ID, { stage: 'First Call & Payment', searchQuery: 'morales', limit: '1', cursor: page1.nextCursor }));
      expect(response.status).toBe(400);
    });
  });
});
