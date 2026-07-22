import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';

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

function requestFor(templateId: string, organizationId: string | null) {
  const url = organizationId
    ? `http://localhost/api/workflow-templates/${templateId}?organizationId=${organizationId}`
    : `http://localhost/api/workflow-templates/${templateId}`;
  return GET(new Request(url), { params: Promise.resolve({ templateId }) });
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

describe('GET /api/workflow-templates/[templateId] — mock mode', () => {
  it('returns the template when id and organizationId both match', async () => {
    const response = await requestFor(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflowTemplate.id).toBe(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID);
  });

  it('returns 404 when the template id exists but belongs to a different organization', async () => {
    const response = await requestFor(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('returns 404 for a nonexistent template id', async () => {
    const response = await requestFor('no-such-template', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });
});

describe('GET /api/workflow-templates/[templateId] — wix mode', () => {
  it('joins template + version collections for a single template lookup', async () => {
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
      return Promise.resolve({
        dataItems: [
          {
            id: 'v1',
            dataCollectionId: 'workflowTemplateVersions',
            data: {
              beaconTemplateId: 'workflow-template-standard-cremation',
              version: 1,
              caseTypes: ['cremation'],
              stages: [],
              intake: { sections: [] },
              createdAt: '2026-07-22T00:49:03.000Z',
            },
          },
        ],
      });
    });

    const response = await requestFor('workflow-template-standard-cremation', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflowTemplate.id).toBe('workflow-template-standard-cremation');
    expect(body.workflowTemplate.versions).toHaveLength(1);
    expect(body.workflowTemplate.versions[0].version).toBe(1);
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('workflowTemplates', {
      filter: { beaconTemplateId: 'workflow-template-standard-cremation', organizationId: DEFAULT_ORGANIZATION_ID },
      paging: { limit: 1 },
    });
  });

  it('returns 404 when Wix has no matching template', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });

    const response = await requestFor('no-such-template', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('returns 404 when the template exists in Wix but under a different organization', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    // Simulates the real Wix query: the compound filter (beaconTemplateId +
    // organizationId) means a template belonging to a different org never
    // appears in dataItems at all — never fetched, never leaked, not just
    // filtered out after the fact.
    mockQueryWixDataItems.mockImplementation((collectionId: string, query: { filter?: Record<string, unknown> }) => {
      if (collectionId === 'workflowTemplates' && query.filter?.organizationId === SECOND_MOCK_ORGANIZATION_ID) {
        return Promise.resolve({ dataItems: [] });
      }
      throw new Error('should not query workflowTemplateVersions when the template lookup itself found nothing');
    });

    const response = await requestFor(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404);
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('workflowTemplates', {
      filter: { beaconTemplateId: STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, organizationId: SECOND_MOCK_ORGANIZATION_ID },
      paging: { limit: 1 },
    });
  });

  it('fails cleanly with a clear message when required config is missing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    const response = await requestFor('workflow-template-standard-cremation', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/WIX_API_KEY, WIX_SITE_ID/);
  });
});
