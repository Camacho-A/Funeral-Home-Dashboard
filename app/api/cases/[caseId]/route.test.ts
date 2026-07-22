import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
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

const { GET } = await import('./route');

function requestFor(caseId: string, organizationId: string | null) {
  const url = organizationId
    ? `http://localhost/api/cases/${caseId}?organizationId=${organizationId}`
    : `http://localhost/api/cases/${caseId}`;
  return GET(new Request(url), { params: Promise.resolve({ caseId }) });
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
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
