import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { standardCremationWorkflowTemplateFixture } from '@/services/__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot } from '@/domain/workflow/snapshot';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockUpdateWixDataItem = vi.fn();
let mockInsertWixDataItem = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    // Manors go-live pagination fix (2026-09): see the identical comment
    // in app/api/cases/route.test.ts.
    queryAllWixDataItems: async (collectionId: string, filter?: Record<string, unknown>) => {
      getWixServerConfig();
      const response = await mockQueryWixDataItems(collectionId, { filter });
      return response.dataItems;
    },
    updateWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockUpdateWixDataItem(...args);
    },
    // Phase 24 (Case Activity Timeline & Audit Center): activityService's
    // record() calls this for every case-update activity event.
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

// Task #15 (2026-09, future-historical-date validation): the PATCH route
// only fetches the organization (for resolveOrgLocalToday's timezone) when
// the patch actually contains one of the five protected date fields — see
// the identical mock in app/api/cases/route.test.ts. Defaults to null (no
// organization record, UTC fallback) unless a test needs a specific
// timezone.
let mockGetOrganization = vi.fn().mockResolvedValue(null);
vi.mock('@/services/organizationProvisioningService', () => ({
  getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
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
  createdBy: 'staff-dana',
  createdAt: '2026-07-22T00:00:00.000Z',
};

function patchRequest(caseId: string, body: unknown, headers: Record<string, string> = {}) {
  return PATCH(
    new Request(`http://localhost/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

// Manors launch-prep (Dispatch role): GET/PATCH now gate on case.read/
// case.update (or the narrower pickup.read/pickup.update) — every wix-mode
// test below runs as mockDefaultUser's 'administrator' role, so the
// mocked queryWixDataItems must resolve a real 'roles'/'rolePermissions'
// answer for it, not just 'cases' data. Collection-aware, mirroring
// app/api/cases/[caseId]/order/route.test.ts's own wix-mode pattern.
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
const ADMINISTRATOR_ROLE_PERMISSION_ITEMS = ['case.read', 'case.update', 'task.assign'].map((permissionKey) => ({
  id: `role-permission-administrator-${permissionKey}`,
  dataCollectionId: 'rolePermissions',
  data: { beaconRolePermissionId: `role-permission-administrator-${permissionKey}`, roleId: 'role-administrator', permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
}));

/** A collection-aware mockQueryWixDataItems implementation — 'roles'/
    'rolePermissions' always resolve to the administrator seed above;
    'cases' resolves to whatever the caller passes (defaulting to the
    file's one standard case row), so per-test overrides only need to
    describe the case-shaped part, never re-seed roles/permissions. */
function mockWixQueries(caseItems: { id: string; dataCollectionId: string; data: unknown }[] = [{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]) {
  mockQueryWixDataItems.mockImplementation((collectionId: string) => {
    if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
    if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
    if (collectionId === 'cases') return Promise.resolve({ dataItems: caseItems });
    return Promise.resolve({ dataItems: [] });
  });
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
  mockUpdateWixDataItem = vi.fn();
  mockInsertWixDataItem = vi.fn().mockResolvedValue({ id: 'activity-event-mock', dataCollectionId: 'activityEvents', data: {} });
  mockGetOrganization = vi.fn().mockResolvedValue(null);
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

    mockWixQueries([
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
    mockWixQueries([]);

    const response = await requestFor('no-such-case', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('returns 404 when the case exists in Wix under a different organization the caller IS authorized for (compound filter finds nothing)', async () => {
    mockSession = { user: mockMultiOrgUser };
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockWixQueries([]);

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
    mockWixQueries();
    mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  });

  describe('authorization', () => {
    it('rejects a cross-site request (CSRF)', async () => {
      const response = await patchRequest(
        '1042',
        { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'x' } },
        { origin: 'https://evil.example.com' },
      );
      expect(response.status).toBe(403);
    });

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
      mockWixQueries([]); // compound filter finds nothing for org B
      const response = await patchRequest('1042', { organizationId: SECOND_MOCK_ORGANIZATION_ID, patch: { decedentName: 'x' } });
      expect(response.status).toBe(404);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });
  });

  describe('payment data rejection (Phase 19A)', () => {
    it.each(['cardNumber', 'cardExp', 'cardExpiration', 'cardCvv', 'cvv', 'cardholderName', 'billingZip'])(
      'rejects a request with "%s" nested in patch, with 400, before any lookup or write',
      async (key) => {
        const response = await patchRequest('1042', {
          organizationId: DEFAULT_ORGANIZATION_ID,
          patch: { decedentName: 'Renamed', [key]: 'forged-value' },
        });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toMatch(new RegExp(key));
        expect(mockQueryWixDataItems).not.toHaveBeenCalled();
        expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
      },
    );

    it('rejects a request with a forbidden field at the top level (outside patch) too', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        cardNumber: 'forged-value',
        patch: { decedentName: 'Renamed' },
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toMatch(/cardNumber/);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('de-duplicates and lists every forbidden field found across both the top level and patch', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        cardNumber: 'forged-value',
        patch: { decedentName: 'Renamed', cardNumber: 'also-forged', cardCvv: '123' },
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toMatch(/cardNumber/);
      expect(body.error).toMatch(/cardCvv/);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('never echoes the forged card value back in the error response', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { cardNumber: '4111111111111111' },
      });
      const bodyText = await response.text();
      expect(bodyText).not.toContain('4111111111111111');
    });

    it('still allows a legitimate patch with no forbidden fields', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { decedentName: 'Renamed' },
      });
      expect(response.status).toBe(200);
    });
  });

  describe('validation', () => {
    it('returns 400 when organizationId is missing from the body', async () => {
      const response = await patchRequest('1042', { patch: { decedentName: 'x' } });
      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
      const response = await PATCH(
        new Request('http://localhost/api/cases/1042', {
          method: 'PATCH',
          headers: { origin: 'http://localhost', host: 'localhost' },
          body: '{not json',
        }),
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
      // SOLIS ALL-CAPS data standard (2026-09): normalized on update.
      expect(mergedData.decedentName).toBe('RENAMED');
    });

    it('ignores an attempt to reassign caseNumber via the patch — the Case Number is permanent and always read-only', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { decedentName: 'Renamed', caseNumber: 'B2026-999' },
      });
      const body = await response.json();

      const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
      expect(mergedData.caseNumber).toBe(EXISTING_WIX_CASE_DATA.caseNumber);
      expect(body.case.caseNumber).toBe(EXISTING_WIX_CASE_DATA.caseNumber);
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

  /**
   * Case Information sync fix (2026-09), end-to-end through the real route
   * handler. Root cause: ChecklistCard's own field-backed textbox commits
   * through hooks/useCaseMutations.ts#setFieldValue, which sends a
   * fieldValues-only patch — this proves the route's response (what Case
   * Detail's React Query cache is seeded with via setQueryData) now
   * reflects the synced structured field immediately, with no second
   * fetch required.
   */
  describe('field-backed checklist item -> structured Case field sync (2026-09)', () => {
    const CASE_WITH_FIELD_BACKED_MAPPINGS = {
      ...EXISTING_WIX_CASE_DATA,
      weight: '',
      timeOfDeath: '',
      workflowSnapshot: {
        workflowTemplateId: 'workflow-template-standard-cremation',
        workflowTemplateVersion: 1,
        stages: [],
        intake: {
          sections: [
            {
              key: 'decedent',
              label: 'Decedent',
              fields: [
                { key: 'weight', label: 'Weight', checklistItemIndex: 3, mapsToCaseField: 'weight' },
                { key: 'timeOfDeath', label: 'Time of death', checklistItemIndex: 5, mapsToCaseField: 'timeOfDeath' },
              ],
            },
          ],
        },
      },
    };

    it('16. a checklist-only fieldValues patch updates the structured Weight field in the route\'s own response (Case Detail query refresh)', async () => {
      mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: CASE_WITH_FIELD_BACKED_MAPPINGS }]);
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { fieldValues: { 3: '178 lb' } },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.weight).toBe('178 lb');
      const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
      expect(mergedData.weight).toBe('178 lb');
    });

    it('21. the full merged object sent to Wix preserves every unrelated field on this fieldValues-only sync patch', async () => {
      mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: CASE_WITH_FIELD_BACKED_MAPPINGS }]);
      await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { fieldValues: { 3: '178 lb' } } });

      const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
      expect(mergedData.decedentName).toBe(CASE_WITH_FIELD_BACKED_MAPPINGS.decedentName);
      expect(mergedData.nextOfKinName).toBe(CASE_WITH_FIELD_BACKED_MAPPINGS.nextOfKinName);
      expect(mergedData.caseNumber).toBe(CASE_WITH_FIELD_BACKED_MAPPINGS.caseNumber);
    });
  });

  describe('successful update', () => {
    it('updates an allowed field and returns the mapped, updated case', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'Renamed' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      // SOLIS ALL-CAPS data standard (2026-09): normalized on update.
      expect(body.case.decedentName).toBe('RENAMED');
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ decedentName: 'RENAMED' }));
    });

    it('sends the full merged object to Wix, preserving fields the patch did not touch', async () => {
      await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isVeteran: true } });

      const mergedData = mockUpdateWixDataItem.mock.calls[0][2];
      expect(mergedData.isVeteran).toBe(true);
      expect(mergedData.nextOfKinName).toBe(EXISTING_WIX_CASE_DATA.nextOfKinName);
      expect(mergedData.decedentName).toBe(EXISTING_WIX_CASE_DATA.decedentName);
    });

    it('VA responsibility correction (2026-09): accepts vaNotificationResponsibility independently of isVeteran, and rejects an invalid value', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { vaNotificationResponsibility: 'family' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.vaNotificationResponsibility).toBe('family');
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ vaNotificationResponsibility: 'family' }));
      // isVeteran was never part of this patch — confirms the two facts
      // are updated independently, never coupled.
      expect(body.case.isVeteran).toBe(EXISTING_WIX_CASE_DATA.isVeteran);
    });

    it('rejects an invalid vaNotificationResponsibility value', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { vaNotificationResponsibility: 'internal' } });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/vaNotificationResponsibility/);
    });

    it('accepts vaNotificationResponsibility: null (reverting to undecided)', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { vaNotificationResponsibility: null } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.case.vaNotificationResponsibility).toBeNull();
    });

    it('edits nextOfKinEmail, trimming surrounding whitespace before saving (Manors launch-prep)', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { nextOfKinEmail: '  karen@example.com  ' },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.nextOfKinEmail).toBe('karen@example.com');
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ nextOfKinEmail: 'karen@example.com' }));
    });

    it('clears nextOfKinEmail to null', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { nextOfKinEmail: null } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.nextOfKinEmail).toBeNull();
    });

    it('rejects a malformed nextOfKinEmail with 400, before any write', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { nextOfKinEmail: 'not-an-email' } });
      expect(response.status).toBe(400);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('edits nextOfKinRelationship to a valid value (Manors launch-prep)', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { nextOfKinRelationship: 'daughter' },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.nextOfKinRelationship).toBe('daughter');
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ nextOfKinRelationship: 'daughter' }));
    });

    it('staff-facing terminology (2026-09): rejects marking pickupStatus released without a valid Released to/Released date, with 422, before any write', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { pickupStatus: 'released' } });
      expect(response.status).toBe(422);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('staff-facing terminology (2026-09): accepts marking pickupStatus released when Released to/Released date are supplied in the same patch', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.pickupStatus).toBe('released');
      // SOLIS ALL-CAPS data standard (2026-09): pickupReleasedTo normalizes
      // like every other name field.
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith(
        'cases',
        '1042',
        expect.objectContaining({ pickupStatus: 'released', pickupReleasedTo: 'KAREN ELLISON', pickupReleasedAt: '07/10/2026' }),
      );
    });

    it('staff-facing terminology (2026-09): rejects clearing Released to to blank on an already-released case, with 422, before any write', async () => {
      mockWixQueries([
        {
          id: '1042',
          dataCollectionId: 'cases',
          data: { ...EXISTING_WIX_CASE_DATA, pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' },
        },
      ]);
      mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
      );

      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { pickupReleasedTo: null } });

      expect(response.status).toBe(422);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('staff-facing terminology (2026-09): reverting pickupStatus back to awaiting_pickup is never gated by the Released to/Released date requirement', async () => {
      mockWixQueries([
        {
          id: '1042',
          dataCollectionId: 'cases',
          data: { ...EXISTING_WIX_CASE_DATA, pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' },
        },
      ]);
      mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
      );

      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { pickupStatus: 'awaiting_pickup' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.pickupStatus).toBe('awaiting_pickup');
    });

    it('edits nextOfKinRelationshipOther (trimming is the caller\'s responsibility at this layer, matching tagNumber/pickupNote)', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { nextOfKinRelationship: 'other', nextOfKinRelationshipOther: 'family friend' },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.nextOfKinRelationship).toBe('other');
      // SOLIS ALL-CAPS data standard (2026-09): normalized on update.
      expect(body.case.nextOfKinRelationshipOther).toBe('FAMILY FRIEND');
    });

    it('clears nextOfKinRelationship to null', async () => {
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { nextOfKinRelationship: null } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.case.nextOfKinRelationship).toBeNull();
    });

    it('rejects an unrecognized nextOfKinRelationship value with 400, before any write', async () => {
      const response = await patchRequest('1042', {
        organizationId: DEFAULT_ORGANIZATION_ID,
        patch: { nextOfKinRelationship: 'cousin-twice-removed' },
      });
      expect(response.status).toBe(400);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('Phase 24: records a case.updated activity event carrying only the changed field, not the whole case', async () => {
      await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'Renamed' } });

      expect(mockInsertWixDataItem).toHaveBeenCalledWith(
        'activityEvents',
        expect.objectContaining({ eventType: 'case.updated', category: 'cases', resourceId: '1042' }),
        expect.any(String),
      );
      const eventData = mockInsertWixDataItem.mock.calls[0][1];
      // SOLIS ALL-CAPS data standard (2026-09): normalized before the
      // activity event's newValue is ever recorded.
      expect(JSON.parse(eventData.newValue)).toEqual({ decedentName: 'RENAMED' });
      expect(JSON.parse(eventData.previousValue)).toEqual({ decedentName: EXISTING_WIX_CASE_DATA.decedentName });
    });

    it('Phase 24: a rawStage change records case.stage.changed instead of (or alongside) case.updated', async () => {
      await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { rawStage: 1 } });

      expect(mockInsertWixDataItem).toHaveBeenCalledWith(
        'activityEvents',
        expect.objectContaining({ eventType: 'case.stage.changed', category: 'cases' }),
        expect.any(String),
      );
      // A pure stage-only patch must not also emit a redundant case.updated.
      expect(mockInsertWixDataItem).not.toHaveBeenCalledWith('activityEvents', expect.objectContaining({ eventType: 'case.updated' }), expect.any(String));
    });

    it('Phase 24: a stage change alongside another field change shares one correlationId across both events', async () => {
      await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { rawStage: 1, decedentName: 'Renamed' } });

      const calls = mockInsertWixDataItem.mock.calls.filter((call) => call[0] === 'activityEvents');
      expect(calls).toHaveLength(2);
      const correlationIds = calls.map((call) => call[1].correlationId);
      expect(correlationIds[0]).toBe(correlationIds[1]);
      expect(correlationIds[0]).toBeTruthy();
    });

    it("Phase 24: an activity-recording failure never fails the actual case update", async () => {
      mockInsertWixDataItem.mockRejectedValue(new Error('activityEvents collection unavailable'));
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'Still Works' } });
      expect(response.status).toBe(200);
      const body = await response.json();
      // SOLIS ALL-CAPS data standard (2026-09): normalized on update.
      expect(body.case.decedentName).toBe('STILL WORKS');
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

  describe('Phase 30 (Identity Model Hardening & Staff Assignment Unification): assignedStaffId reassignment', () => {
    // Manors go-live fix: identityId-filtered so the caller's own profile
    // (staff-dana, resolveStaffProfileForCaller) and the reassignment
    // TARGET (staff-chris) resolve as genuinely distinct rows — an
    // earlier version of this mock returned the same single item for
    // every staffProfiles query regardless of filter, which silently
    // made every "reassign to staff-chris" test take the self-assignment
    // code path (no case.reassign check at all) instead of actually
    // exercising the other-staff-member path this permission gates.
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
    const ACTIVE_STAFF_PROFILE_ITEM = {
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
    const INACTIVE_STAFF_PROFILE_ITEM = {
      ...ACTIVE_STAFF_PROFILE_ITEM,
      id: 'staff-inactive',
      data: { ...ACTIVE_STAFF_PROFILE_ITEM.data, beaconStaffProfileId: 'staff-inactive', isActive: false },
    };

    // mockDefaultUser's real role ('administrator') must resolve
    // case.update/case.reassign under DATA_ADAPTER=wix — the 'roles'/
    // 'rolePermissions' collections need mocking too, not just
    // 'staffProfiles'/'cases'.
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
    const ADMINISTRATOR_ROLE_PERMISSION_ITEMS = ['case.update', 'case.reassign', 'task.assign'].map((permissionKey) => ({
      id: `role-permission-administrator-${permissionKey}`,
      dataCollectionId: 'rolePermissions',
      data: { beaconRolePermissionId: `role-permission-administrator-${permissionKey}`, roleId: 'role-administrator', permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
    }));

    function mockCaseAndStaffProfiles(
      staffProfileItem: typeof ACTIVE_STAFF_PROFILE_ITEM | null,
      roleItem: { id: string; dataCollectionId: string; data: unknown } = ADMINISTRATOR_ROLE_ITEM,
      rolePermissionItems: typeof ADMINISTRATOR_ROLE_PERMISSION_ITEMS = ADMINISTRATOR_ROLE_PERMISSION_ITEMS,
    ) {
      const profileItems = [CALLER_STAFF_PROFILE_ITEM, ...(staffProfileItem ? [staffProfileItem] : [])];
      mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
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
        if (collectionId === 'roles') return Promise.resolve({ dataItems: [roleItem] });
        if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: rolePermissionItems });
        return Promise.resolve({ dataItems: [{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }] });
      });
    }

    it('accepts reassignment to an active, in-organization staff profile', async () => {
      mockCaseAndStaffProfiles(ACTIVE_STAFF_PROFILE_ITEM);
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assignedStaffId: 'staff-chris' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ caseHandlerId: 'staff-chris' }));
      void body;
    });

    it('rejects reassignment to a nonexistent staff profile, with 422, before any write', async () => {
      mockCaseAndStaffProfiles(null);
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assignedStaffId: 'staff-does-not-exist' } });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.error).toMatch(/staff-does-not-exist/);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('rejects reassignment to a deactivated staff profile, with 422', async () => {
      mockCaseAndStaffProfiles(INACTIVE_STAFF_PROFILE_ITEM);
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assignedStaffId: 'staff-inactive' } });

      expect(response.status).toBe(422);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('allows unassigning (a null patch value) with no staff-profile lookup at all', async () => {
      mockQueryWixDataItems.mockImplementation((collectionId: string) => {
        if (collectionId === 'staffProfiles') throw new Error('must not be queried for a null (unassign) patch');
        if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMINISTRATOR_ROLE_ITEM] });
        if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: ADMINISTRATOR_ROLE_PERMISSION_ITEMS });
        return Promise.resolve({ dataItems: [{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }] });
      });
      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assignedStaffId: null } });
      expect(response.status).toBe(200);
    });

    it('accepts self-reassignment (assignedStaffId === the caller\'s own StaffProfile.id) with no case.reassign permission at all', async () => {
      const OFFICE_STAFF_ROLE_ITEM = { id: 'role-officeStaff', dataCollectionId: 'roles', data: { beaconRoleId: 'role-officeStaff', key: 'officeStaff', name: 'Office Staff', description: '', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } };
      const OFFICE_STAFF_ROLE_PERMISSION_ITEMS = ['case.update'].map((permissionKey) => ({
        id: `role-permission-officeStaff-${permissionKey}`,
        dataCollectionId: 'rolePermissions',
        data: { beaconRolePermissionId: `role-permission-officeStaff-${permissionKey}`, roleId: 'role-officeStaff', permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
      }));
      mockCaseAndStaffProfiles(null, OFFICE_STAFF_ROLE_ITEM, OFFICE_STAFF_ROLE_PERMISSION_ITEMS);

      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assignedStaffId: 'staff-dana' } });
      expect(response.status).toBe(200);
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ caseHandlerId: 'staff-dana' }));
    });

    it('Office Staff (case.update, no case.reassign) cannot reassign a case to a different staff member, with 422, before any write', async () => {
      const OFFICE_STAFF_ROLE_ITEM = { id: 'role-officeStaff', dataCollectionId: 'roles', data: { beaconRoleId: 'role-officeStaff', key: 'officeStaff', name: 'Office Staff', description: '', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } };
      const OFFICE_STAFF_ROLE_PERMISSION_ITEMS = ['case.update'].map((permissionKey) => ({
        id: `role-permission-officeStaff-${permissionKey}`,
        dataCollectionId: 'rolePermissions',
        data: { beaconRolePermissionId: `role-permission-officeStaff-${permissionKey}`, roleId: 'role-officeStaff', permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
      }));
      mockCaseAndStaffProfiles(ACTIVE_STAFF_PROFILE_ITEM, OFFICE_STAFF_ROLE_ITEM, OFFICE_STAFF_ROLE_PERMISSION_ITEMS);

      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { assignedStaffId: 'staff-chris' } });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.error).toMatch(/case.reassign/);
      expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    });

    it('Office Staff (case.update, no case.reassign) can still update an ordinary case field', async () => {
      const OFFICE_STAFF_ROLE_ITEM = { id: 'role-officeStaff', dataCollectionId: 'roles', data: { beaconRoleId: 'role-officeStaff', key: 'officeStaff', name: 'Office Staff', description: '', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } };
      const OFFICE_STAFF_ROLE_PERMISSION_ITEMS = ['case.update'].map((permissionKey) => ({
        id: `role-permission-officeStaff-${permissionKey}`,
        dataCollectionId: 'rolePermissions',
        data: { beaconRolePermissionId: `role-permission-officeStaff-${permissionKey}`, roleId: 'role-officeStaff', permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
      }));
      mockCaseAndStaffProfiles(null, OFFICE_STAFF_ROLE_ITEM, OFFICE_STAFF_ROLE_PERMISSION_ITEMS);
      mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
      );

      const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'Updated Name' } });
      expect(response.status).toBe(200);
      // SOLIS ALL-CAPS data standard (2026-09): normalized on update.
      expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ decedentName: 'UPDATED NAME' }));
    });
  });
});

describe('PATCH /api/cases/[caseId] — Task #15 (2026-09, future-historical-date validation)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockWixQueries();
    mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  });

  const farFutureDate = `01/01/${new Date().getFullYear() + 5}`;

  it('rejects a future Date of Birth with 422, before any write', async () => {
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { dateOfBirth: farFutureDate } });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('Date of Birth cannot be in the future.');
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a future Date of Death with 422', async () => {
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { dateOfDeath: farFutureDate } });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('Date of Death cannot be in the future.');
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a future Released date with 422', async () => {
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: farFutureDate },
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('Released date cannot be in the future.');
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a future Date shipped with 422', async () => {
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { shippingDateShipped: farFutureDate } });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('Date shipped cannot be in the future.');
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a future Delivered date with 422', async () => {
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { shippingDeliveredAt: farFutureDate } });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('Delivered date cannot be in the future.');
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('a valid past Date of Death still succeeds', async () => {
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { dateOfDeath: '07/09/2026' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.dateOfDeath).toBe('07/09/2026');
  });

  it('looks up the organization\'s own timezone only when a protected date field is present in the patch', async () => {
    mockGetOrganization = vi.fn().mockResolvedValue({ timezone: 'America/New_York' });

    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { dateOfDeath: '07/09/2026' } });
    expect(response.status).toBe(200);
    expect(mockGetOrganization).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'wix');
  });

  it('never fetches the organization when the patch contains no date field', async () => {
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'Renamed' } });
    expect(response.status).toBe(200);
    expect(mockGetOrganization).not.toHaveBeenCalled();
  });

  it('never re-validates an already-persisted (unrelated, untouched) future-looking dateOfDeath merely because a different field is edited', async () => {
    // Confirms the "leave existing records untouched unless the user edits
    // the relevant field" requirement: an existing (however it got there)
    // out-of-range dateOfDeath must not block an unrelated edit.
    mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: { ...EXISTING_WIX_CASE_DATA, dateOfDeath: farFutureDate } }]);

    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { placeOfDeath: 'Test Hospital' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.dateOfDeath).toBe(farFutureDate); // left exactly as-is
  });
});

// Manors launch-prep (Dispatch role). A caller with only pickup.read/
// pickup.update (never case.read/case.update) — mirrors the collection-
// aware mocking pattern above, seeding a 'role-dispatch' role instead.
describe('Dispatch (pickup-only) authorization — GET and PATCH /api/cases/[caseId]', () => {
  const DISPATCH_ROLE_ITEM = {
    id: 'role-dispatch',
    dataCollectionId: 'roles',
    data: {
      beaconRoleId: 'role-dispatch',
      key: 'dispatch',
      name: 'Dispatch',
      description: 'Pickup/removal work only.',
      organizationId: null,
      isSystemDefault: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const DISPATCH_ROLE_PERMISSION_ITEMS = ['pickup.read', 'pickup.update'].map((permissionKey) => ({
    id: `role-permission-dispatch-${permissionKey}`,
    dataCollectionId: 'rolePermissions',
    data: { beaconRolePermissionId: `role-permission-dispatch-${permissionKey}`, roleId: 'role-dispatch', permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
  }));

  function mockDispatchQueries(caseItems: { id: string; dataCollectionId: string; data: unknown }[]) {
    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'roles') return Promise.resolve({ dataItems: [DISPATCH_ROLE_ITEM] });
      if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: DISPATCH_ROLE_PERMISSION_ITEMS });
      if (collectionId === 'cases') return Promise.resolve({ dataItems: caseItems });
      return Promise.resolve({ dataItems: [] });
    });
  }

  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    // The role KEY string here is what mockDefaultUser resolves to via the
    // mock membership fixtures — swapped to 'dispatch' just for this
    // describe block via a dedicated session override below, not a real
    // fixture change (see mockSession assignment per test).
  });

  it('GET returns a redacted pickup-only view — no NOK, no financial, no other Case field', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);
    // mockDefaultUser's own resolved role string is irrelevant here — the
    // mocked 'roles'/'rolePermissions' queries always resolve to
    // 'dispatch' regardless of the requested key, exactly mirroring how
    // this file's other ADMINISTRATOR_ROLE_ITEM mocks already simplify
    // role resolution (see mockCaseAndStaffProfiles above).
    const response = await requestFor('1042', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case).toEqual({
      id: '1042',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-001',
      decedentName: 'Test Decedent',
      pickupStatus: 'awaiting_pickup',
      pickupReleasedTo: null,
      pickupReleasedAt: null,
      pickupNote: null,
      returnMethod: 'undecided',
    });
    expect(body.case.nextOfKinName).toBeUndefined();
    expect(body.case.nextOfKinPhone).toBeUndefined();
    expect(body.case.paymentStatus).toBeUndefined();
  });

  it('PATCH accepts a pickup-only field change and returns a redacted view', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);
    mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );

    // Staff-facing terminology (2026-09): marking released requires a valid
    // Released to/Released date in the same (or already-persisted) patch —
    // see domain/cases/pickupRelease.ts.
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.pickupStatus).toBe('released');
    expect(body.case.nextOfKinName).toBeUndefined();
    // SOLIS ALL-CAPS data standard (2026-09): pickupReleasedTo normalizes
    // like every other name field.
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith(
      'cases',
      '1042',
      expect.objectContaining({ pickupStatus: 'released', pickupReleasedTo: 'KAREN ELLISON', pickupReleasedAt: '07/10/2026' }),
    );
  });

  it('PATCH rejects a pickup-only attempt to mark released without a valid Released to/Released date, with 422, before any write', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);

    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { pickupStatus: 'released' } });

    expect(response.status).toBe(422);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('PATCH rejects an attempt to change a non-pickup field, with 403, before any write', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);

    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'Forged Name' } });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('PATCH rejects an attempt to change Weight specifically (case field editing, 2026-09) — pickup-only staff cannot edit ordinary Case information', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);

    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { weight: '210 lb', fieldValues: { 3: '210 lb' } },
    });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('PATCH rejects an attempt to change Time of Death specifically (case field editing, 2026-09) — pickup-only staff cannot edit ordinary Case information', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);

    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { timeOfDeath: '15:45', fieldValues: { 5: '15:45' } },
    });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('PATCH rejects an attempt to change a Certifier field specifically (2026-09, ADR-041) — pickup-only staff cannot edit ordinary Case information', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);

    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { certifierName: 'DR. JANE FOSTER' },
    });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('PATCH rejects a mixed patch (one pickup field + one non-pickup field) entirely, with 403, before any write', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);

    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { pickupStatus: 'released', decedentName: 'Forged Name' },
    });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  // Conditional shipping/tracking (2026-09): Dispatch reads returnMethod
  // (already asserted by the GET test above) but may never write it, and
  // has no visibility into any shipping field at all — see
  // domain/cases/pickupView.ts's own comment.
  it('GET never includes any shipping detail field in the redacted view', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: { ...EXISTING_WIX_CASE_DATA, shippingCarrier: 'USPS', shippingTrackingNumber: '9400111899223197428019' } }]);
    const response = await requestFor('1042', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.shippingCarrier).toBeUndefined();
    expect(body.case.shippingTrackingNumber).toBeUndefined();
    expect(body.case.shippingDateShipped).toBeUndefined();
    expect(body.case.shippingDeliveryStatus).toBeUndefined();
    expect(body.case.shippingDeliveredAt).toBeUndefined();
  });

  it('PATCH rejects an attempt to change returnMethod, with 403, before any write', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { returnMethod: 'shipping' } });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('PATCH rejects an attempt to write any shipping field, with 403, before any write', async () => {
    mockDispatchQueries([{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }]);
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { shippingCarrier: 'USPS', shippingTrackingNumber: '9400111899223197428019' },
    });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/cases/[caseId] — conditional shipping/tracking (2026-09)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  function mockAdminQueries(caseData: Record<string, unknown> = EXISTING_WIX_CASE_DATA) {
    mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: caseData }]);
    mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  }

  it('a full case editor can change returnMethod from undecided to shipping without providing any tracking info', async () => {
    mockAdminQueries();
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { returnMethod: 'shipping' } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.returnMethod).toBe('shipping');
    expect(body.case.shippingCarrier).toBeNull();
    expect(body.case.shippingTrackingNumber).toBeNull();
  });

  it('switching Pickup to Shipping preserves previously entered pickup data untouched', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, returnMethod: 'pickup', pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' });
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { returnMethod: 'shipping' } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.returnMethod).toBe('shipping');
    expect(body.case.pickupStatus).toBe('released');
    expect(body.case.pickupReleasedTo).toBe('Karen Ellison');
    expect(body.case.pickupReleasedAt).toBe('07/10/2026');
    // The PATCH request never even mentioned the pickup fields — confirming
    // they were carried through applyCaseUpdateToWixData's merge, not
    // silently cleared by the returnMethod change.
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison' }));
  });

  it('switching Shipping to Pickup preserves previously entered shipping data untouched', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, returnMethod: 'shipping', shippingCarrier: 'USPS', shippingTrackingNumber: '9400111899223197428019', shippingDeliveryStatus: 'shipped' });
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { returnMethod: 'pickup' } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.returnMethod).toBe('pickup');
    expect(body.case.shippingCarrier).toBe('USPS');
    expect(body.case.shippingTrackingNumber).toBe('9400111899223197428019');
    expect(body.case.shippingDeliveryStatus).toBe('shipped');
  });

  it('a late undecided -> shipping change never moves rawStage backward or forward', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, currentStage: 4, returnMethod: 'undecided' });
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { returnMethod: 'shipping' } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.rawStage).toBe(4);
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', '1042', expect.objectContaining({ currentStage: 4 }));
  });

  it('shipping fields remain editable once the case has reached the terminal stage', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, currentStage: 7, returnMethod: 'shipping', shippingCarrier: 'USPS' });
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { shippingTrackingNumber: '9400111899223197428019', shippingDeliveryStatus: 'delivered' },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.shippingTrackingNumber).toBe('9400111899223197428019');
    expect(body.case.shippingDeliveryStatus).toBe('delivered');
  });

  it('records a specific "Return method changed" activity event, not the generic case.updated bucket', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, returnMethod: 'pickup' });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { returnMethod: 'shipping' } });
    const activityInsertCalls = mockInsertWixDataItem.mock.calls.filter(([collectionId]) => collectionId === 'activityEvents');
    expect(activityInsertCalls.some(([, data]) => (data as Record<string, unknown>).description === 'Return method changed from Pickup to Shipping.')).toBe(true);
    expect(activityInsertCalls.some(([, data]) => (data as Record<string, unknown>).eventType === 'case.updated' && String((data as Record<string, unknown>).description).includes('returnMethod'))).toBe(false);
  });

  it('records "Tracking number added." the first time, "Tracking number updated." on a later change', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, returnMethod: 'shipping', shippingTrackingNumber: null });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { shippingTrackingNumber: '9400111899223197428019' } });
    let activityInsertCalls = mockInsertWixDataItem.mock.calls.filter(([collectionId]) => collectionId === 'activityEvents');
    expect(activityInsertCalls.some(([, data]) => (data as Record<string, unknown>).description === 'Tracking number added.')).toBe(true);

    mockInsertWixDataItem.mockClear();
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, returnMethod: 'shipping', shippingTrackingNumber: '9400111899223197428019' });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { shippingTrackingNumber: '9400111899223197428020' } });
    activityInsertCalls = mockInsertWixDataItem.mock.calls.filter(([collectionId]) => collectionId === 'activityEvents');
    expect(activityInsertCalls.some(([, data]) => (data as Record<string, unknown>).description === 'Tracking number updated.')).toBe(true);
  });

  it('records "Shipment marked delivered." only when shippingDeliveryStatus newly becomes delivered', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, returnMethod: 'shipping', shippingDeliveryStatus: 'shipped' });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { shippingDeliveryStatus: 'delivered' } });
    const activityInsertCalls = mockInsertWixDataItem.mock.calls.filter(([collectionId]) => collectionId === 'activityEvents');
    expect(activityInsertCalls.some(([, data]) => (data as Record<string, unknown>).description === 'Shipment marked delivered.')).toBe(true);
  });
});

/**
 * Task #6 (2026-09, checklist completion → workflow reconciliation). Root
 * cause: a checklistState-only patch (the normal checkbox-toggle path)
 * never itself carried a rawStage change, so it never triggered
 * reconcileCaseWorkflow — a case whose current stage's checklist just
 * became fully complete (e.g. the last item in a stage, like the real
 * "Hardsave for state approval if not an online doctor" item at raw stage
 * 3) never advanced past it; it sat there showing "Review case"
 * (domain/cases/viewModel.ts's own fallback nextActionLabel, not a real
 * stage) forever.
 *
 * Stage 3's own 3-item checklist (EDRS submitted & sent to doctor / Cause
 * of death entered / Hardsave...) has its first two items default-done
 * (domain/workflow/resolveChecklist.ts's own `defaultDone` rule: every
 * item but the last defaults to done) — so completing raw stage 3 only
 * ever requires the ONE explicit checklistState entry for the last item
 * (local index 2). isArrangementFormLinked's own Wix reads (caseFormLinks)
 * are deliberately left unmocked here (the catch-all "unknown collection
 * -> empty dataItems" branch in mockWixQueries already covers them) —
 * stage 2's own single item is instead satisfied directly via
 * checklistState[0], avoiding the need to also mock case-form-link/
 * external-form-config collections for what this suite is actually
 * testing (the new reconciliation wiring, not reconcileCaseWorkflow's own
 * already-tested internals).
 */
describe('PATCH /api/cases/[caseId] — Task #6 (2026-09, checklist completion triggers workflow reconciliation)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  const RECONCILIATION_TEMPLATE_VERSION = standardCremationWorkflowTemplateFixture.versions[0];
  const RECONCILIATION_SNAPSHOT = buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, RECONCILIATION_TEMPLATE_VERSION);

  /** Mirrors the "conditional shipping/tracking" describe block's own
      mockAdminQueries exactly (that one is scoped to its own describe
      block, not reusable here) — full admin role + an updateWixDataItem
      echo of whatever merged data it receives. */
  function mockAdminQueries(caseData: Record<string, unknown> = EXISTING_WIX_CASE_DATA) {
    mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: caseData }]);
    mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  }

  /** A case sitting at raw stage 3 (displayStage 2, EDRS) with every
      earlier stage trusted via the computeFirstIncompleteRawStage skip
      optimization — only EDRS's own checklist (`stage3ChecklistState`,
      keyed by its own LOCAL index) varies per test; composite-keyed
      internally to displayStage 2 per B2026-035's fix
      (domain/workflow/checklistItemKey.ts). */
  function stage3CaseData(stage3ChecklistState: Record<number, boolean>): Record<string, unknown> {
    const EDRS_DISPLAY_STAGE = 2;
    const compositeStage3State = Object.fromEntries(
      Object.entries(stage3ChecklistState).map(([index, value]) => [`${EDRS_DISPLAY_STAGE}:${index}`, value]),
    );
    return {
      ...EXISTING_WIX_CASE_DATA,
      currentStage: 3,
      workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
      workflowTemplateVersion: RECONCILIATION_TEMPLATE_VERSION.version,
      workflowSnapshot: RECONCILIATION_SNAPSHOT,
      fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X', 9: 'X', 10: 'X' },
      checklistState: { '0:0': true, '0:8': true, '0:9': true, '0:10': true, ...compositeStage3State },
    };
  }

  it('A. Stage 3 with Hardsave (local index 2) still incomplete remains at rawStage 3, even though the request itself carries a checklistState patch', async () => {
    mockAdminQueries(stage3CaseData({}));
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '0:0': true, '0:8': true, '0:9': true, '0:10': true } },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.rawStage).toBe(3);
  });

  it('B. Stage 3 with Hardsave checked and every other Stage 3 requirement already satisfied (by default) advances to Stage 4 — and the SAME response already reflects it', async () => {
    mockAdminQueries(stage3CaseData({ 2: true }));
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '0:0': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true } },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.rawStage).toBe(4);
  });

  it('C. Partial checklist completion (only an already-default-done item re-affirmed, Hardsave itself still false) does not advance', async () => {
    mockAdminQueries(stage3CaseData({}));
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '0:0': true, '0:8': true, '0:9': true, '0:10': true } },
    });
    const body = await response.json();
    expect(body.case.rawStage).toBe(3);
  });

  it('D. the checklistState patch is what triggers reconciliation — Stage 4 is the observable proof (no rawStage field appears anywhere in the request body)', async () => {
    mockAdminQueries(stage3CaseData({ 2: true }));
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '0:0': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true } },
    });
    const body = await response.json();
    expect(body.case.rawStage).toBe(4);
  });

  it('E. an unrelated Case update WITHOUT checklistState does not trigger reconciliation, even when every prerequisite is already satisfied (would otherwise advance to Stage 4)', async () => {
    mockAdminQueries(stage3CaseData({ 2: true }));
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { decedentName: 'RENAMED DECEDENT' },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.case.decedentName).toBe('RENAMED DECEDENT');
    // Reconciliation never ran — the response still shows the stale
    // rawStage 3, exactly matching what updateWixDataItem's own echo
    // returned (no separate reconciliation write occurred).
    expect(body.case.rawStage).toBe(3);
  });

  it('G. repeating the same completed checklist update is safe/idempotent — the second, identical request never double-advances past Stage 4', async () => {
    const patchBody = {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '0:0': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true } },
    };

    // First request: Stage 3 -> Stage 4, mirroring test B exactly.
    mockAdminQueries(stage3CaseData({ 2: true }));
    const first = await patchRequest('1042', patchBody);
    const firstBody = await first.json();
    expect(firstBody.case.rawStage).toBe(4);

    // Second, identical request: the backend now genuinely reports
    // currentStage 4 (as it would for real, having persisted the first
    // request) — re-running the exact same checklistState patch must not
    // advance any further, and must not error.
    mockAdminQueries({ ...stage3CaseData({ 2: true }), currentStage: 4 });
    const second = await patchRequest('1042', patchBody);
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.case.rawStage).toBe(4);
  });
});

/**
 * B2026-035 hardening (2026-10) — server-side checklistState write
 * validation, the real production (Wix-mode) path. Mirrors
 * services/casesService.test.ts's identical mock-mode suite exactly —
 * both call the same domain/workflow/checklistItemKey.ts#findInvalidChecklistStatePatchEntries.
 * Seeds a case at rawStage 4 (Permit & Authorization, displayStage 3, 2
 * items) — the real B2026-035 stage.
 */
describe('PATCH /api/cases/[caseId] — checklistState write validation (B2026-035 hardening, 2026-10)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  const VALIDATION_TEMPLATE_VERSION = standardCremationWorkflowTemplateFixture.versions[0];
  const VALIDATION_SNAPSHOT = buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, VALIDATION_TEMPLATE_VERSION);

  function mockAdminQueries(caseData: Record<string, unknown> = EXISTING_WIX_CASE_DATA) {
    mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: caseData }]);
    mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  }

  function permitStageCaseData(checklistState: Record<string, boolean> = {}): Record<string, unknown> {
    return {
      ...EXISTING_WIX_CASE_DATA,
      currentStage: 4,
      workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
      workflowTemplateVersion: VALIDATION_TEMPLATE_VERSION.version,
      workflowSnapshot: VALIDATION_SNAPSHOT,
      checklistState,
    };
  }

  it('1. rejects a newly-introduced bare legacy-shaped key with 400, never 500/200', async () => {
    mockAdminQueries(permitStageCaseData({}));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '1': true } } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.case).toBeNull();
    expect(body.error).toMatch(/canonical/);
  });

  it('2. rejects a malformed composite key with 400', async () => {
    mockAdminQueries(permitStageCaseData({}));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { 'x:y': true } } });
    expect(response.status).toBe(400);
  });

  it('3. rejects a negative stage/index with 400', async () => {
    mockAdminQueries(permitStageCaseData({}));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '-1:0': true } } });
    expect(response.status).toBe(400);
  });

  it('4. rejects a non-boolean checklist value with 400', async () => {
    mockAdminQueries(permitStageCaseData({}));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '3:1': 'yes' } } });
    expect(response.status).toBe(400);
  });

  it('5. accepts a valid composite key that exists in the case\'s own workflow snapshot', async () => {
    mockAdminQueries(permitStageCaseData({}));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '3:1': true } } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.checklistState['3:1']).toBe(true);
  });

  it('6. an invalid checklist patch performs no persistence — updateWixDataItem is never called', async () => {
    mockAdminQueries(permitStageCaseData({ '3:1': true }));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '1': true } } });
    expect(response.status).toBe(400);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('7. an unchanged legacy key carried forward in the patch is never rejected — a case mid-migration can still be edited', async () => {
    mockAdminQueries(permitStageCaseData({ '1': true })); // pre-migration bare key already stored
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '1': true, '3:0': true } }, // '1' unchanged, '3:0' new and valid
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.checklistState['1']).toBe(true);
    expect(body.case.checklistState['3:0']).toBe(true);
  });

  it('10. Task #6 reconciliation remains functional alongside validation — a valid, changing composite-key write still advances rawStage', async () => {
    // mockWixQueries returns one static snapshot for every query, including
    // reconcileCaseWorkflow's own re-fetch — so (mirroring the existing
    // Task #6 suite's stage3CaseData({2: true}) pattern above) the mocked
    // "existing" data must already reflect the post-patch checklistState,
    // not the pre-patch one, or reconciliation re-reads stale state.
    mockAdminQueries(permitStageCaseData({ '3:1': true }));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '3:1': true } } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.rawStage).toBe(5);
  });
});
