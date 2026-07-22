import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

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
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
  };
});

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

function mockEnabledTemplate() {
  mockQueryWixDataItems.mockImplementation((collectionId: string) => {
    if (collectionId === 'workflowTemplates') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_ITEM] });
    if (collectionId === 'workflowTemplateVersions') return Promise.resolve({ dataItems: [WORKFLOW_TEMPLATE_VERSION_ITEM] });
    return Promise.resolve({ dataItems: [] });
  });
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  mockSession = { user: mockDefaultUser };
});

afterEach(() => {
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

    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [
        {
          id: '1042',
          dataCollectionId: 'cases',
          data: {
            beaconCaseId: '1042',
            organizationId: DEFAULT_ORGANIZATION_ID,
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
      ],
    });

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
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cases).toEqual([]);
  });

  it('skips a malformed case record instead of throwing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [{ id: 'x', dataCollectionId: 'cases', data: { decedentName: 'Missing required fields' } }],
    });

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
    const response = await POST(new Request('http://localhost/api/cases', { method: 'POST', body: '{not json' }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when a required field is missing or empty', async () => {
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, decedentName: '' }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/decedentName/);
  });

  it('returns 400 when an optional field has the wrong type', async () => {
    const response = await POST(postRequest({ ...VALID_CREATE_BODY, weight: 123 }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when DATA_ADAPTER is not wix', async () => {
    process.env.DATA_ADAPTER = 'mock';
    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(400);
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
    expect(body.case.decedentName).toBe('Test Decedent');
    expect(body.case.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(body.case.workflowTemplateId).toBe('workflow-template-standard-cremation');
    expect(body.case.rawStage).toBe(0);
    expect(body.case.isDeleted).toBe(false);
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
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });
    const response = await POST(postRequest(VALID_CREATE_BODY));
    expect(response.status).toBe(422);
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
