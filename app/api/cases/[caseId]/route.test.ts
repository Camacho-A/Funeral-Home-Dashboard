import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockUpdateWixDataItem = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    updateWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockUpdateWixDataItem(...args);
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

const { GET, PATCH } = await import('./route');

function requestFor(caseId: string, organizationId: string | null) {
  const url = organizationId
    ? `http://localhost/api/cases/${caseId}?organizationId=${organizationId}`
    : `http://localhost/api/cases/${caseId}`;
  return GET(new Request(url), { params: Promise.resolve({ caseId }) });
}

const EXISTING_WIX_CASE_DATA = {
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
  createdBy: 'staff-dana',
  createdAt: '2026-07-22T00:00:00.000Z',
};

function patchRequest(caseId: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
  mockUpdateWixDataItem = vi.fn();
  mockSession = { user: mockDefaultUser };
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('GET /api/cases/[caseId] — authorization', () => {
  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
    const response = await requestFor(known.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(401);
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });

  it("returns 403 (not 404) for the single-org default user requesting a case under the second organization — rejected before any fixture lookup", async () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
    const response = await requestFor(known.id, SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(403);
    expect(mockQueryWixDataItems).not.toHaveBeenCalled();
  });
});

describe('GET /api/cases/[caseId] — mock mode', () => {
  it('returns the case when id and organizationId both match', async () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
    const response = await requestFor(known.id, DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.id).toBe(known.id);
  });

  it('returns 404 when the case exists but belongs to a different organization the caller IS authorized for', async () => {
    mockSession = { user: mockMultiOrgUser };
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
    const response = await requestFor(known.id, SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('returns 404 for a nonexistent case id', async () => {
    const response = await requestFor('no-such-case', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });
});

describe('GET /api/cases/[caseId] — wix mode', () => {
  it('maps a real Wix query result and applies the compound organizationId filter', async () => {
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

    const response = await requestFor('1042', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.id).toBe('1042');
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('cases', {
      filter: { beaconCaseId: '1042', organizationId: DEFAULT_ORGANIZATION_ID, isArchived: false },
      paging: { limit: 1 },
    });
  });

  it('returns 404 when Wix has no matching case', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await requestFor('no-such-case', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('returns 404 when the case exists in Wix under a different organization the caller IS authorized for (compound filter finds nothing)', async () => {
    mockSession = { user: mockMultiOrgUser };
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await requestFor('1042', SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404);
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('cases', {
      filter: { beaconCaseId: '1042', organizationId: SECOND_MOCK_ORGANIZATION_ID, isArchived: false },
      paging: { limit: 1 },
    });
  });

  it('fails cleanly with a clear message when required config is missing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    const response = await requestFor('1042', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/WIX_API_KEY, WIX_SITE_ID/);
  });
});

describe('PATCH /api/cases/[caseId]', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({
      dataItems: [{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }],
    });
    mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  });

  describe('authorization', () => {
    it('returns 401 when there is no session at all', async () => {
      mockSession = null;
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'x' } });
      expect(response.status).toBe(401);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('returns 403 for a forged organizationId — rejected before any lookup or write', async () => {
      const response = await patchRequest('1042', { organizationId: SECOND_MOCK_ORGANIZATION_ID, patch: { decedentName: 'x' } });
      expect(response.status).toBe(403);
      expect(mockQueryWixDataItems).not.toHaveBeenCalled();
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it("returns 404 (not the case's real data) when the case belongs to a different organization the caller IS authorized for — cross-tenant update rejected", async () => {
      mockSession = { user: mockMultiOrgUser };
      mockQueryWixDataItems.mockResolvedValue({ dataItems: [] }); // compound filter finds nothing for org B
      const response = await patchRequest('1042', { organizationId: SECOND_MOCK_ORGANIZATION_ID, patch: { decedentName: 'x' } });
      expect(response.status).toBe(404);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('returns 400 when organizationId is missing from the body', async () => {
      const response = await patchRequest('1042', { patch: { decedentName: 'x' } });
      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
      const response = await PATCH(
        new Request('http://localhost/api/cases/1042', { method: 'PATCH', body: '{not json' }),
        { params: Promise.resolve({ caseId: '1042' }) },
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when a patch field is present but the wrong type', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isVeteran: 'yes' } });
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toMatch(/isVeteran/);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('returns 400 when DATA_ADAPTER is not wix', async () => {
      process.env.DATA_ADAPTER = 'mock';
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'x' } });
      expect(response.status).toBe(400);
    });
  });

  describe('protected-field reassignment', () => {
    it('ignores an attempt to reassign organizationId via the patch — the update still targets and preserves the authorized organization', async () => {
      await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { decedentName: 'Renamed', organizationId: SECOND_MOCK_ORGANIZATION_ID },
      });

      const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
      expect(mergedData.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
      expect(mergedData.decedentName).toBe('Renamed');
    });

    it('ignores an attempt to reassign workflowTemplateId/intakeOwnerId/createdBy/workflowSnapshot via the patch', async () => {
      await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: {
          decedentName: 'Renamed',
          workflowTemplateId: 'forged',
          intakeOwnerId: 'staff-someone-else',
          createdBy: 'staff-someone-else',
          workflowSnapshot: { stages: [] },
        },
      });

      const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
      expect(mergedData.workflowTemplateId).toBe('workflow-template-standard-cremation');
      expect(mergedData.intakeOwnerId).toBe('staff-dana');
      expect(mergedData.createdBy).toBe('staff-dana');
      expect(mergedData.workflowSnapshot).toEqual(EXISTING_WIX_CASE_DATA.workflowSnapshot);
    });
  });

  describe('successful update', () => {
    it('updates an allowed field and returns the mapped, updated case', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'Renamed' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.decedentName).toBe('Renamed');
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ decedentName: 'Renamed' }));
    });

    it('sends the full merged object to Wix, preserving fields the patch did not touch', async () => {
      await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isVeteran: true } });

      const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
      expect(mergedData.isVeteran).toBe(true);
      expect(mergedData.nextOfKinName).toBe(EXISTING_WIX_CASE_DATA.nextOfKinName);
      expect(mergedData.decedentName).toBe(EXISTING_WIX_CASE_DATA.decedentName);
    });
  });

  describe('Wix failure handling', () => {
    it('propagates a Wix write failure as a 503 without leaking internal details', async () => {
      mockUpdateWixDataItem.mockRejectedValue(new Error('Wix Data update failed for collection "cases" (HTTP 500).'));
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'x' } });
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).not.toMatch(/test-key/);
    });
  });
});
