import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';

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

const { GET } = await import('./route');

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

describe('GET /api/cases — mock mode', () => {
  it("lists only this organization's non-deleted cases", async () => {
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cases.length).toBeGreaterThan(0);
    expect(body.cases.every((c: { organizationId: string; isDeleted: boolean }) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)).toBe(true);
  });

  it('a mismatched organizationId returns an empty list, not a cross-tenant leak', async () => {
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

  it('returns an empty array for an organization with no cases', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await GET(requestFor('org-with-no-cases'));
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
