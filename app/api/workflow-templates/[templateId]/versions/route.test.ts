import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import {
  standardCremationWorkflowTemplateFixture,
  STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID,
} from '@/services/__mocks__/workflowTemplates';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import type { IntakeTemplate, StageTemplate } from '@/types/workflowTemplate';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockInsertWixDataItem = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  const actual = await vi.importActual<typeof import('@/lib/wixDataApi')>('@/lib/wixDataApi');
  return {
    WixDataApiError: actual.WixDataApiError,
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

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');
const { WixDataApiError } = await import('@/lib/wixDataApi');

function stage(rawStage: number, label: string): StageTemplate {
  return {
    rawStage,
    displayStage: rawStage,
    label,
    isAttentionStage: false,
    slaTargetDays: 2,
    checklist: { items: [{ index: 0, label: `${label} item`, hasField: false }] },
  };
}

const DEFAULT_TEST_INTAKE: IntakeTemplate = {
  sections: [{ key: 'decedent', label: 'Decedent', fields: [{ key: 'decedentName', label: 'Name of deceased' }] }],
};

function postRequest(templateId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/workflow-templates/${templateId}/versions`, {
      method: 'POST',
      // Stage-focused tests below only care about `stages`; a valid
      // minimal `intake` is filled in here by default so they don't all
      // need to repeat one, matching Phase 19's DTO requiring both.
      body: JSON.stringify({ intake: DEFAULT_TEST_INTAKE, ...body }),
    }),
    { params: Promise.resolve({ templateId }) },
  );
}

const WIX_TEMPLATE_ITEM = {
  id: 'wix-item-1',
  dataCollectionId: 'workflowTemplates',
  data: {
    beaconTemplateId: STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    isSystemTemplate: false,
    name: 'Standard Cremation Workflow',
    isEnabled: true,
    caseTypes: ['cremation'],
  },
};
const WIX_VERSION_ITEM = {
  id: 'wix-item-2',
  dataCollectionId: 'workflowTemplateVersions',
  data: {
    beaconTemplateId: STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID,
    version: 1,
    caseTypes: ['cremation'],
    stages: [stage(0, 'First Call & Payment')],
    intake: { sections: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
};

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
  // Mock-mode POST tests push new versions onto the shared, module-level
  // fixture — reset it back to its original single version so later tests
  // (in this file or any other importing the same fixture module) see the
  // same starting state every time.
  standardCremationWorkflowTemplateFixture.versions.length = 1;
});

describe('POST /api/workflow-templates/[templateId]/versions — authorization', () => {
  it('returns 401 when there is no session', async () => {
    mockSession = null;
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'Renamed')],
    });
    expect(response.status).toBe(401);
  });

  it('returns 403 for an organization the caller is not authorized for', async () => {
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
      stages: [stage(0, 'Renamed')],
    });
    expect(response.status).toBe(403);
  });

  it('returns 400 when organizationId is missing from the body', async () => {
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, { stages: [stage(0, 'X')] });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/workflow-templates/[templateId]/versions — validation', () => {
  it('rejects a malformed stages payload with 400 and never touches the fixture', async () => {
    const beforeCount = standardCremationWorkflowTemplateFixture.versions.length;
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [{ label: 'Missing everything else' }],
    });
    expect(response.status).toBe(400);
    expect(standardCremationWorkflowTemplateFixture.versions.length).toBe(beforeCount);
  });

  it('rejects a structurally invalid stages array (e.g. a rawStage gap) with 400', async () => {
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'A'), stage(2, 'B')],
    });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.details.some((e: string) => e.includes('expected 1'))).toBe(true);
  });

  it('rejects a blank stage label with 400', async () => {
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [{ ...stage(0, ''), label: '' }],
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/workflow-templates/[templateId]/versions — mock mode', () => {
  it('appends a new version with number = latest + 1, preserving caseTypes from the latest version', async () => {
    const editedStages = [stage(0, 'Renamed First Stage')];
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: editedStages,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflowTemplate.versions).toHaveLength(2);
    const newVersion = body.workflowTemplate.versions[1];
    expect(newVersion.version).toBe(2);
    expect(newVersion.stages[0].label).toBe('Renamed First Stage');
    expect(newVersion.caseTypes).toEqual(standardCremationWorkflowTemplateFixture.versions[0].caseTypes);
  });

  it('persists an edited intake structure as part of the new version (Phase 19)', async () => {
    const editedIntake: IntakeTemplate = {
      sections: [
        {
          key: 'decedent',
          label: 'Decedent',
          fields: [
            {
              key: 'decedentName',
              label: 'Name of deceased',
              fieldType: 'text',
              required: true,
              uppercase: true,
            },
            { key: 'email', label: 'Email', fieldType: 'email', validationType: 'email' },
          ],
        },
      ],
    };
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'A')],
      intake: editedIntake,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    const newVersion = body.workflowTemplate.versions[1];
    expect(newVersion.intake).toEqual(editedIntake);
  });

  it('rejects an intake with a duplicate field key with 400 and never touches the fixture', async () => {
    const beforeCount = standardCremationWorkflowTemplateFixture.versions.length;
    const badIntake: IntakeTemplate = {
      sections: [{ key: 's', label: 'S', fields: [{ key: 'dup', label: 'A' }, { key: 'dup', label: 'B' }] }],
    };
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'A')],
      intake: badIntake,
    });
    expect(response.status).toBe(400);
    expect(standardCremationWorkflowTemplateFixture.versions.length).toBe(beforeCount);
  });

  it('rejects a malformed intake payload (wrong-typed Phase 19 property) with 400', async () => {
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'A')],
      intake: { sections: [{ key: 's', label: 'S', fields: [{ key: 'x', label: 'X', required: 'yes' }] }] },
    });
    expect(response.status).toBe(400);
  });

  it('never mutates the historical version — version 1 is untouched after editing', async () => {
    const originalV1Label = standardCremationWorkflowTemplateFixture.versions[0].stages[0].label;
    await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'Completely Different Name')],
    });

    expect(standardCremationWorkflowTemplateFixture.versions[0].stages[0].label).toBe(originalV1Label);
  });

  it('returns 404 for a template id that does not belong to this organization', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
      stages: [stage(0, 'X')],
    });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/workflow-templates/[templateId]/versions — wix mode', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'workflowTemplates') return Promise.resolve({ dataItems: [WIX_TEMPLATE_ITEM] });
      return Promise.resolve({ dataItems: [WIX_VERSION_ITEM] });
    });
    mockInsertWixDataItem.mockResolvedValue({ id: 'new-item-id', dataCollectionId: 'workflowTemplateVersions', data: {} });
  });

  it('inserts a new version row with itemId "{templateId}-v{version}" and never calls update', async () => {
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'Renamed via Wix')],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockInsertWixDataItem).toHaveBeenCalledWith(
      'workflowTemplateVersions',
      expect.objectContaining({ beaconTemplateId: STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, version: 2 }),
      `${STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID}-v2`,
    );
    expect(body.workflowTemplate.versions).toHaveLength(2);
  });

  it('returns 404 when the template does not exist in Wix for this organization', async () => {
    mockQueryWixDataItems.mockResolvedValue({ dataItems: [] });
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'X')],
    });
    expect(response.status).toBe(404);
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });

  it('returns 409 with a clear message when two edits collide on the same version number', async () => {
    mockInsertWixDataItem.mockRejectedValue(new WixDataApiError('Wix Data insert failed (HTTP 409).', 409));
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'X')],
    });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/reload the latest version/i);
  });

  it('propagates a genuine Wix failure as 503', async () => {
    mockInsertWixDataItem.mockRejectedValue(new Error('network down'));
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'X')],
    });
    expect(response.status).toBe(503);
  });
});
