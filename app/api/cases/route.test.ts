import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { orgLocalYear } from '@/domain/cases/caseNumber';

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
vi.mock('@/lib/wixCaseNumberSequence', () => ({
  reserveNextCaseNumber: (...args: unknown[]) => mockReserveNextCaseNumber(...args),
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
