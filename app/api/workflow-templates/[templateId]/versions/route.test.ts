import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import {
  standardCremationWorkflowTemplateFixture,
  STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID,
} from '@/services/__mocks__/workflowTemplates';
import { mockDefaultUser, mockMultiOrgUser, mockReadOnlyUser, mockManagerUser } from '@/services/__mocks__/authFixtures';
import { organizationRolePermissionOverrideFixtures } from '@/services/__mocks__/rbacFixtures';
import { organizationRolePermissionOverrideId } from '@/domain/rbac/deterministicIds';
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

// Task #11 security follow-up (2026-09). The POST route now calls
// canPublishWorkflow before any write. Under DATA_ADAPTER=mock this
// resolves against real in-memory RBAC fixtures with no extra mocking
// needed (mockDefaultUser is a real 'administrator', which genuinely has
// workflow.publish) — see the dedicated "Authorization" describe block
// below, which exercises that real resolution end to end. This partial
// mock exists only for the pre-existing tests below whose own concern is
// version-creation *mechanics*, not authorization, and which use either a
// user/org combination with no real RBAC role (mockMultiOrgUser's
// 'caseManager') or DATA_ADAPTER=wix (whose RBAC resolution would need
// its own Wix collection mocking this file doesn't otherwise set up) —
// those explicitly opt back into a real/false resolution per test.
vi.mock('@/services/authorizationPolicyService', async () => {
  const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>(
    '@/services/authorizationPolicyService',
  );
  return { ...actual, canPublishWorkflow: (...args: Parameters<typeof actual.canPublishWorkflow>) => mockCanPublishWorkflow(...args) };
});
const { canPublishWorkflow: realCanPublishWorkflow } = await vi.importActual<
  typeof import('@/services/authorizationPolicyService')
>('@/services/authorizationPolicyService');
let mockCanPublishWorkflow: typeof realCanPublishWorkflow = realCanPublishWorkflow;

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

function postRequest(templateId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/workflow-templates/${templateId}/versions`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost', ...headers },
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
  mockCanPublishWorkflow = realCanPublishWorkflow;
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
  // Task #11 security follow-up: any test-scoped grant/revoke override
  // pushed onto this shared, module-level fixture must not leak into
  // later tests (in this file or any other importing the same module).
  organizationRolePermissionOverrideFixtures.length = 0;
});

describe('POST /api/workflow-templates/[templateId]/versions — authorization', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(
      STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID,
      { organizationId: DEFAULT_ORGANIZATION_ID, stages: [stage(0, 'Renamed')] },
      { origin: 'https://evil.example.com' },
    );
    expect(response.status).toBe(403);
  });

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

/**
 * Task #11 security follow-up (2026-09). Previously this route had no
 * RBAC check at all beyond organization membership — any authenticated
 * staff member could create a new workflow template version. These tests
 * exercise the real `canPublishWorkflow`/`workflow.publish` resolution end
 * to end (no service-level mocking — see the top-level
 * authorizationPolicyService mock's own comment for why that's safe here)
 * against real mock-mode RBAC fixtures, proving the write is genuinely
 * blocked before it happens, not merely hidden by the UI.
 */
describe('POST /api/workflow-templates/[templateId]/versions — RBAC (Task #11 security follow-up, 2026-09)', () => {
  it('denies an authenticated organization member without workflow.publish (readOnly)', async () => {
    mockSession = { user: mockReadOnlyUser };
    const beforeCount = standardCremationWorkflowTemplateFixture.versions.length;
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'Renamed by readOnly')],
    });
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toBe('Not authorized.');
    // Zero write: no new version, no mutation of the existing one.
    expect(standardCremationWorkflowTemplateFixture.versions.length).toBe(beforeCount);
    expect(standardCremationWorkflowTemplateFixture.versions[0].stages[0].label).not.toBe('Renamed by readOnly');
  });

  it('allows an authorized administrator (workflow.publish via the base role) to save a new version, unchanged from before this fix', async () => {
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'Renamed by administrator')],
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.workflowTemplate.versions).toHaveLength(2);
  });

  it('allows an authorized manager (workflow.publish via the base role, distinct from administrator) to save a new version', async () => {
    mockSession = { user: mockManagerUser };
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'Renamed by manager')],
    });
    expect(response.status).toBe(200);
  });

  it('cross-tenant: a caller with no membership in the target organization is denied at the organization-authorization step, before the RBAC/permission check ever runs', async () => {
    mockSession = { user: mockMultiOrgUser }; // no membership row in DEFAULT_ORGANIZATION_ID at all
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'X')],
    });
    expect(response.status).toBe(403);
  });

  it('an organization-specific grant override respects "base ∪ grants": readOnly (no base workflow.publish) becomes authorized once granted', async () => {
    organizationRolePermissionOverrideFixtures.push({
      id: organizationRolePermissionOverrideId(DEFAULT_ORGANIZATION_ID, 'readOnly', 'workflow.publish'),
      organizationId: DEFAULT_ORGANIZATION_ID,
      roleKey: 'readOnly',
      permissionKey: 'workflow.publish',
      action: 'grant',
      reason: 'Task #11 security follow-up test',
      createdAt: '2026-09-28T00:00:00.000Z',
      createdBy: 'test-admin',
      updatedAt: '2026-09-28T00:00:00.000Z',
    });
    mockSession = { user: mockReadOnlyUser };
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'Renamed via granted readOnly')],
    });
    expect(response.status).toBe(200);
  });

  it('an organization-specific revoke override wins over the base role grant: administrator (has workflow.publish by default) is denied once revoked', async () => {
    organizationRolePermissionOverrideFixtures.push({
      id: organizationRolePermissionOverrideId(DEFAULT_ORGANIZATION_ID, 'administrator', 'workflow.publish'),
      organizationId: DEFAULT_ORGANIZATION_ID,
      roleKey: 'administrator',
      permissionKey: 'workflow.publish',
      action: 'revoke',
      reason: 'Task #11 security follow-up test',
      createdAt: '2026-09-28T00:00:00.000Z',
      createdBy: 'test-admin',
      updatedAt: '2026-09-28T00:00:00.000Z',
    });
    const beforeCount = standardCremationWorkflowTemplateFixture.versions.length;
    const response = await postRequest(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      stages: [stage(0, 'Renamed despite revoke')],
    });
    expect(response.status).toBe(403);
    expect(standardCremationWorkflowTemplateFixture.versions.length).toBe(beforeCount);
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
    // mockMultiOrgUser's membership in SECOND_MOCK_ORGANIZATION_ID uses the
    // legacy 'caseManager' role string, which resolves no real RBAC grants
    // at all — irrelevant to what this test actually checks (tenant-scoped
    // template lookup), so authorization is granted here explicitly rather
    // than this test silently asserting a 403 it was never about.
    mockCanPublishWorkflow = async () => true;
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
    // Task #11 security follow-up: this describe block's own concern is
    // Wix insert mechanics, not RBAC resolution, and mockQueryWixDataItems
    // below isn't shaped to answer real 'roles'/'rolePermissions' queries
    // — bypass the (now-real-by-default) authorization check here so
    // these pre-existing tests keep testing what they always tested. Real
    // authorization resolution (allow/deny) is covered by the dedicated
    // "Authorization" describe block further down, under mock mode.
    mockCanPublishWorkflow = async () => true;
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
