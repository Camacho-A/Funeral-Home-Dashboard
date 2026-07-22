import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workflowTemplatesService } from './workflowTemplatesService';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { standardCremationWorkflowTemplateFixture } from './__mocks__/workflowTemplates';

/**
 * Phase 15B: workflowTemplatesService now always fetch()es the Route
 * Handlers under app/api/workflow-templates/ (see that file's own comment
 * for why) — the actual mock-vs-Wix branching and organization-filtering
 * logic now lives there and is tested directly in
 * app/api/workflow-templates/route.test.ts and
 * app/api/workflow-templates/[templateId]/route.test.ts. These tests
 * cover only the service's own thin responsibilities: building the right
 * URL, parsing the response, and getEnabledForCaseType()'s filter logic.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workflowTemplatesService.list', () => {
  it('fetches the correct URL and returns the parsed templates', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ workflowTemplates: [standardCremationWorkflowTemplateFixture] }),
    });

    const templates = await workflowTemplatesService.list({ organizationId: DEFAULT_ORGANIZATION_ID });

    expect(fetchMock).toHaveBeenCalledWith(`/api/workflow-templates?organizationId=${DEFAULT_ORGANIZATION_ID}`);
    expect(templates).toEqual([standardCremationWorkflowTemplateFixture]);
  });

  it('throws on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(workflowTemplatesService.list({ organizationId: DEFAULT_ORGANIZATION_ID })).rejects.toThrow(
      'Failed to load workflow templates.',
    );
  });
});

describe('workflowTemplatesService.get', () => {
  it('fetches the correct URL, including organizationId as a query param', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ workflowTemplate: standardCremationWorkflowTemplateFixture }),
    });

    const template = await workflowTemplatesService.get(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      standardCremationWorkflowTemplateFixture.id,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workflow-templates/${standardCremationWorkflowTemplateFixture.id}?organizationId=${DEFAULT_ORGANIZATION_ID}`,
    );
    expect(template).toEqual(standardCremationWorkflowTemplateFixture);
  });

  it('returns null on a 404 rather than throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const template = await workflowTemplatesService.get({ organizationId: DEFAULT_ORGANIZATION_ID }, 'no-such-id');
    expect(template).toBeNull();
  });
});

describe('workflowTemplatesService.getEnabledForCaseType', () => {
  it('resolves the enabled template for a supported case type', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ workflowTemplates: [standardCremationWorkflowTemplateFixture] }),
    });

    const template = await workflowTemplatesService.getEnabledForCaseType(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      'cremation',
    );
    expect(template?.id).toBe(standardCremationWorkflowTemplateFixture.id);
  });

  it('returns null for a case type with no enabled template', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ workflowTemplates: [standardCremationWorkflowTemplateFixture] }),
    });

    const template = await workflowTemplatesService.getEnabledForCaseType(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      'burial',
    );
    expect(template).toBeNull();
  });
});
