import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, SECOND_ORG_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();

// lib/wixDataApi.ts is mocked so these tests never make a real HTTP call.
// getWixServerConfig() (lib/env.ts) is left unmocked and called for real
// inside the mock factory, so "missing config throws cleanly" is still
// genuinely exercised — the same pattern used in
// app/api/organizations/[organizationId]/route.test.ts.
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

function requestFor(organizationId: string | null) {
  const url = organizationId
    ? `http://localhost/api/workflow-templates?organizationId=${organizationId}`
    : 'http://localhost/api/workflow-templates';
  return new Request(url);
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

describe('GET /api/workflow-templates — request validation', () => {
  it('returns 400 when organizationId is missing', async () => {
    const response = await GET(requestFor(null));
    expect(response.status).toBe(400);
  });
});

describe('GET /api/workflow-templates — mock mode', () => {
  it("lists Manor's Cremation own template for its organization", async () => {
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflowTemplates.map((t: { id: string }) => t.id)).toEqual([STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID]);
  });

  it("returns the second organization's own, differently-shaped template under its own context", async () => {
    const response = await GET(requestFor(SECOND_MOCK_ORGANIZATION_ID));
    const body = await response.json();

    expect(body.workflowTemplates.map((t: { id: string }) => t.id)).toEqual([SECOND_ORG_WORKFLOW_TEMPLATE_ID]);
    expect(body.workflowTemplates[0].caseTypes).toEqual(['burial']);
  });

  it('a mismatched organizationId returns an empty list, not a cross-tenant leak', async () => {
    const response = await GET(requestFor('some-other-org'));
    const body = await response.json();
    expect(body.workflowTemplates).toEqual([]);
  });
});

describe('GET /api/workflow-templates — wix mode', () => {
  it('fails cleanly with a clear message when required config is missing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.workflowTemplates).toEqual([]);
    expect(body.error).toMatch(/WIX_API_KEY, WIX_SITE_ID/);
  });

  it('joins template + version collections and maps to the domain shape', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';

    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'workflowTemplates') {
        return Promise.resolve({
          dataItems: [
            {
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
            },
          ],
        });
      }
      if (collectionId === 'workflowTemplateVersions') {
        return Promise.resolve({
          dataItems: [
            {
              id: 'workflow-template-standard-cremation-v1',
              dataCollectionId: 'workflowTemplateVersions',
              data: {
                beaconTemplateId: 'workflow-template-standard-cremation',
                version: 1,
                caseTypes: ['cremation'],
                stages: [{ rawStage: 0, displayStage: 0, label: 'First Call & Payment', slaTargetDays: 1, checklist: { items: [] } }],
                intake: { sections: [] },
                createdAt: '2026-07-22T00:49:03.000Z',
              },
            },
          ],
        });
      }
      throw new Error(`unexpected collection ${collectionId}`);
    });

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflowTemplates).toHaveLength(1);
    expect(body.workflowTemplates[0]).toEqual({
      id: 'workflow-template-standard-cremation',
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: 'Standard Cremation Workflow',
      isEnabled: true,
      caseTypes: ['cremation'],
      versions: [
        {
          version: 1,
          caseTypes: ['cremation'],
          stages: [{ rawStage: 0, displayStage: 0, label: 'First Call & Payment', slaTargetDays: 1, checklist: { items: [] } }],
          intake: { sections: [] },
          createdAt: '2026-07-22T00:49:03.000Z',
        },
      ],
    });
  });

  it('returns an empty array for an organization with no workflow templates', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await GET(requestFor('org-with-nothing'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflowTemplates).toEqual([]);
  });

  it('excludes a template that has zero versions, rather than returning it broken', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';

    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'workflowTemplates') {
        return Promise.resolve({
          dataItems: [
            {
              id: 'x',
              dataCollectionId: 'workflowTemplates',
              data: {
                beaconTemplateId: 'workflow-template-no-versions',
                organizationId: DEFAULT_ORGANIZATION_ID,
                isSystemTemplate: false,
                name: 'Versionless Template',
                isEnabled: true,
                caseTypes: ['cremation'],
              },
            },
          ],
        });
      }
      return Promise.resolve({ dataItems: [] });
    });

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflowTemplates).toEqual([]);
  });

  it('skips a malformed template record instead of throwing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';

    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'workflowTemplates') {
        return Promise.resolve({
          dataItems: [{ id: 'x', dataCollectionId: 'workflowTemplates', data: { name: 'Missing required fields' } }],
        });
      }
      return Promise.resolve({ dataItems: [] });
    });

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflowTemplates).toEqual([]);
  });

  it('never leaks a raw API key value into the response, even on failure', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'super-secret-test-value';
    // WIX_SITE_ID left unset, so getWixServerConfig() still throws before any network call.

    const response = await GET(requestFor(DEFAULT_ORGANIZATION_ID));
    const bodyText = await response.text();
    expect(bodyText).not.toContain('super-secret-test-value');
  });
});
