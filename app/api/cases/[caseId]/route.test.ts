import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAfterResponse } from '@/lib/afterResponse';
import { fixtureIdentitySession } from '@/lib/auth/testing/fixtureIdentityAuth';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { mockDefaultUser, mockMultiOrgUser, mockMembershipFixtures, mockOrganizationFixtures } from '@/services/__mocks__/authFixtures';
import { standardCremationWorkflowTemplateFixture } from '@/services/__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot, latestTemplateVersion } from '@/domain/workflow/snapshot';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockUpdateWixDataItem = vi.fn();
let mockInsertWixDataItem = vi.fn();
/** Case rows written during the current test, overlaid on every later
    'cases' read — so a second write (e.g. automatic archiving after the
    edit) sees the first, as it would against Wix. Reset per test. */
let writtenCaseRows = new Map<string, Record<string, unknown>>();
/** Every conditional case patch sent, as (fields, condition). */
let conditionalPatchCalls: { fields: Record<string, unknown>; condition: { filter: Record<string, { $eq: unknown }> } }[] = [];
function overlayWrittenCaseRows(collectionId: string, response: { dataItems?: { id: string; data: unknown }[] } | undefined) {
  if (collectionId !== 'cases' || !response?.dataItems) return response;
  return { ...response, dataItems: response.dataItems.map((item) => (writtenCaseRows.has(item.id) ? { ...item, data: writtenCaseRows.get(item.id) } : item)) };
}

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: async (...args: unknown[]) => {
      getWixServerConfig();
      return overlayWrittenCaseRows(args[0] as string, await mockQueryWixDataItems(...args));
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
    // Case concurrency (2026-10): case writes are now field-scoped,
    // revision-conditioned patches. Simulated like Wix: refused with 428
    // unless the stored row still matches the condition; otherwise the
    // fields are applied onto the stored row and the resulting FULL row is
    // passed to mockUpdateWixDataItem, so every existing assertion about
    // "what the row looks like after the write" keeps its meaning.
    conditionalPatchWixDataItemFields: async (
      collectionId: string,
      itemId: string,
      fields: Record<string, unknown>,
      condition: { filter: Record<string, { $eq: unknown }> },
    ) => {
      getWixServerConfig();
      if (collectionId === 'cases') conditionalPatchCalls.push({ fields, condition });
      const response = overlayWrittenCaseRows(collectionId, await mockQueryWixDataItems(collectionId, { filter: { _id: itemId } }));
      const stored = (response?.dataItems ?? []).find((item: { id: string }) => item.id === itemId);
      if (!stored) return { applied: false, status: 404 };
      const data = stored.data as Record<string, unknown>;
      const matches = Object.entries(condition.filter).every(([key, test]) => (data[key] ?? null) === test.$eq);
      if (!matches) return { applied: false, status: 428 };
      const written = await mockUpdateWixDataItem(collectionId, itemId, { ...data, ...fields });
      if (collectionId === 'cases') writtenCaseRows.set(itemId, { ...data, ...fields });
      return { applied: true, dataItem: written ?? { id: itemId, dataCollectionId: collectionId, data: { ...data, ...fields } } };
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
let mockSession: { user: typeof mockDefaultUser } | null = fixtureIdentitySession(mockDefaultUser);
const { regenerateOfficialDocumentsSpy } = vi.hoisted(() => ({ regenerateOfficialDocumentsSpy: vi.fn(async () => ({})) }));
vi.mock('@/services/automaticCaseDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/automaticCaseDocuments')>()),
  regenerateOfficialDocumentsAfterCaseChange: regenerateOfficialDocumentsSpy,
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: async () => undefined,
  clearSession: async () => undefined,
}));
// Tenant-isolation hardening (2026-10): with DATA_ADAPTER=wix, staff routes
// only honor identity-source sessions (a mock-fixture session is a 401,
// as in production). Sessions here are identity sessions for the same
// authFixtures users, authorized by the REAL
// resolveMembershipAuthorizationContext; only its two Wix-backed lookups
// are replaced by fixtures derived 1:1 from mockMembershipFixtures — see
// lib/auth/testing/fixtureIdentityAuth.ts.
vi.mock('@/lib/auth/resolveIdentitySession', async () => (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureResolveIdentitySessionModule);
vi.mock('@/services/membershipService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/membershipService')>()),
  listMembershipsForIdentity: (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureListMembershipsForIdentity,
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

// Historical corrections (2026-10): observe what the expected-pickup sync
// is asked to do (the real one still runs), and let a test switch true
// earlier-stage status off to stand in for any organization but Manors.
const { syncExpectedPickupSpy, earlierStageStatus } = vi.hoisted(() => ({
  syncExpectedPickupSpy: vi.fn(),
  earlierStageStatus: { override: null as boolean | null },
}));
vi.mock('@/services/cremainsPickupService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/cremainsPickupService')>();
  return {
    ...original,
    syncExpectedPickupForCase: (...args: Parameters<typeof original.syncExpectedPickupForCase>) => {
      syncExpectedPickupSpy(...args);
      return original.syncExpectedPickupForCase(...args);
    },
  };
});
vi.mock('@/domain/workflow/earlierStages', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/domain/workflow/earlierStages')>();
  return {
    ...original,
    isTrueEarlierStageStatusEnabled: (organizationId: string | null | undefined) =>
      earlierStageStatus.override ?? original.isTrueEarlierStageStatusEnabled(organizationId),
  };
});

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

/** Case concurrency (2026-10): every save carries the revision it was made
    against. Fixture rows have none (revision 0), so 0 is supplied unless a
    test states its own — or opts out with `expectedRevision: undefined`
    explicitly via `rawPatchRequest`. */
function patchRequest(caseId: string, body: unknown, headers: Record<string, string> = {}) {
  const withRevision =
    body && typeof body === 'object' && !('expectedRevision' in (body as object)) && !headers['if-match']
      ? { ...(body as object), expectedRevision: 0 }
      : body;
  return rawPatchRequest(caseId, withRevision, headers);
}

async function rawPatchRequest(caseId: string, body: unknown, headers: Record<string, string> = {}) {
  vi.mocked(runAfterResponse).mockClear();
  const response = await PATCH(
    new Request(`http://localhost/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ caseId }) },
  );
  await runQueuedAfterResponse();
  return response;
}

/** Checklist save latency (2026-10): the activity log and the expected
    pickup now run after the response. Run them, as the platform would,
    before a test looks at what they wrote. Official documents are left to
    the tests that inspect them. */
async function runQueuedAfterResponse() {
  const queued = vi.mocked(runAfterResponse).mock.calls.filter(([label]) => !String(label).startsWith('official documents'));
  for (const [, task] of queued) await (task as () => Promise<unknown>)();
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
  // Re-seeding the rows starts from exactly these rows.
  writtenCaseRows = new Map();
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
  mockSession = fixtureIdentitySession(mockDefaultUser);
  writtenCaseRows = new Map();
  conditionalPatchCalls = [];
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

/**
 * Archived cases open (2026-10).
 *
 * The detail route used to filter `isArchived: false`, so every archived
 * case 404'd — which the detail page surfaces as "Case ... not found for
 * this organization". That is the error staff hit clicking "Open Case" on
 * a calendar event for an archived case, and the same error the Archived
 * Cases list produced. It also made Restore unreachable, since the only
 * Restore control lives on the case detail page.
 */
describe('GET /api/cases/[caseId] — archived cases open', () => {
  /** No fixture ships archived, so archive one here and put it back —
      otherwise these would pass vacuously. */
  async function withArchivedFixture<T>(run: (archivedId: string) => Promise<T>): Promise<T> {
    const target = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
    const index = caseFixtures.indexOf(target);
    caseFixtures[index] = { ...target, isDeleted: true };
    try {
      return await run(target.id);
    } finally {
      caseFixtures[index] = target;
    }
  }

  it('returns an archived case with its full detail, not a 404', async () => {
    const { status, body, expected } = await withArchivedFixture(async (archivedId) => {
      const response = await requestFor(archivedId, DEFAULT_ORGANIZATION_ID);
      const expected = caseFixtures.find((c) => c.id === archivedId)!;
      return { status: response.status, body: await response.json(), expected };
    });

    expect(status).toBe(200);
    expect(body.case.id).toBe(expected.id);
    // Everything staff open an archived case FOR — the case number, the
    // deceased, next of kin, the checklist history, the workflow it ran.
    expect(body.case.caseNumber).toBe(expected.caseNumber);
    expect(body.case.decedentName).toBe(expected.decedentName);
    expect(body.case.nextOfKinName).toBe(expected.nextOfKinName);
    expect(body.case.checklistState).toEqual(expected.checklistState);
    expect(body.case.workflowSnapshot).toEqual(expected.workflowSnapshot);
  });

  it('reports the case as archived, so the page can render it read-only', async () => {
    const body = await withArchivedFixture(async (archivedId) =>
      (await requestFor(archivedId, DEFAULT_ORGANIZATION_ID)).json(),
    );
    expect(body.case.isDeleted).toBe(true);
  });

  it('reading an archived case never un-archives it', async () => {
    const stillArchived = await withArchivedFixture(async (archivedId) => {
      await requestFor(archivedId, DEFAULT_ORGANIZATION_ID);
      return caseFixtures.find((c) => c.id === archivedId)!.isDeleted;
    });
    expect(stillArchived).toBe(true);
  });

  it('is still organization-scoped — archiving does not open a cross-tenant door', async () => {
    const status = await withArchivedFixture(async (archivedId) => {
      mockSession = fixtureIdentitySession(mockMultiOrgUser);
      return (await requestFor(archivedId, SECOND_MOCK_ORGANIZATION_ID)).status;
    });
    expect(status).toBe(404);
  });

  it('an active case is completely unaffected', async () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
    const response = await requestFor(known.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect((await response.json()).case.id).toBe(known.id);
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
    mockSession = fixtureIdentitySession(mockMultiOrgUser);
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
      filter: { beaconCaseId: '1042', organizationId: DEFAULT_ORGANIZATION_ID },
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
    mockSession = fixtureIdentitySession(mockMultiOrgUser);
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockWixQueries([]);

    const response = await requestFor('1042', SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(404);
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('cases', {
      filter: { beaconCaseId: '1042', organizationId: SECOND_MOCK_ORGANIZATION_ID },
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
      mockSession = fixtureIdentitySession(mockMultiOrgUser);
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
      // The fixture case is already assigned to staff-dana: allowed, and —
      // being a no-op — correctly writes nothing (case concurrency, 2026-10).
      expect((await response.json()).case.assignedStaffId).toBe('staff-dana');
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
    // `tagNumber` deliberately: it is not a completion-affecting field,
    // so it also does not trigger workflow reconciliation (2026-10),
    // which legitimately reads organization data of its own. This test is
    // about the DATE-VALIDATION fetch, and stays about that.
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { tagNumber: 'T-9' } });
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

  // Automatic checklist completion (2026-10): the real (Wix) write path.
  it('a staff untick of an automatically completed item is recorded as a staff decision, in the same write', async () => {
    mockAdminQueries({
      ...stage3CaseData({}),
      checklistCompletions: {
        '0:8': { done: true, method: 'automatic', source: 'payment_confirmed', eventType: 'payment.paid_in_full', eventId: null, at: '2026-10-20T12:00:00.000Z', actorId: 'solis-automation' },
      },
    });
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '0:8': false } } });
    expect(response.status).toBe(200);
    const written = mockUpdateWixDataItem.mock.calls[0][2] as Record<string, Record<string, Record<string, unknown>>>;
    expect(written.checklistState['0:8']).toBe(false);
    expect(written.checklistCompletions['0:8']).toMatchObject({ done: false, method: 'manual', source: 'staff_confirmation', actorId: mockDefaultUser.id });
  });

  it('checklist save latency (2026-10): a tick that finishes nothing is answered without waiting for the activity log or the expected pickup', async () => {
    mockAdminQueries(stage3CaseData({}));
    vi.mocked(runAfterResponse).mockClear();
    mockInsertWixDataItem.mockClear();
    const response = await PATCH(
      new Request('http://localhost/api/cases/1042', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '0:8': false } }, expectedRevision: 0 }),
      }),
      { params: Promise.resolve({ caseId: '1042' }) },
    );
    expect(response.status).toBe(200);
    // One write — no stage write, since the tick could not finish the stage.
    expect(mockUpdateWixDataItem).toHaveBeenCalledTimes(1);
    // Nothing logged yet: it is queued to run after the response.
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
    const labels = vi.mocked(runAfterResponse).mock.calls.map(([label]) => String(label));
    expect(labels).toEqual(expect.arrayContaining(['expected cremains pickup for case 1042', 'activity for case 1042']));

    await runQueuedAfterResponse();
    expect(mockInsertWixDataItem).toHaveBeenCalledWith('activityEvents', expect.objectContaining({ eventType: 'case.updated' }), expect.any(String));
  });

  it('never accepts completion records from the browser', async () => {
    mockAdminQueries(stage3CaseData({}));
    await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '2:0': true }, checklistCompletions: { '2:0': { done: true, method: 'automatic', source: 'payment_confirmed', eventType: 'x', eventId: null, at: 'x', actorId: 'x' } } },
    });
    for (const call of mockUpdateWixDataItem.mock.calls) {
      const completions = (call[2] as Record<string, Record<string, { method: string }>>).checklistCompletions;
      // Only the server's own record of the staff tick, never the client's claim.
      expect(completions?.['2:0']?.method ?? 'manual').toBe('manual');
    }
  });

  it('Date of Cremation saved from Case Information goes to the same field and the same Certificate trigger as the Schedule tab', async () => {
    const original = { ...stage3CaseData({}), tagNumber: 'T-1042', dateOfCremation: null } as Record<string, unknown>;
    mockAdminQueries(original);
    vi.mocked(runAfterResponse).mockClear();
    regenerateOfficialDocumentsSpy.mockClear();
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { dateOfCremation: '07/15/2026' } });
    expect(response.status).toBe(200);
    const written = mockUpdateWixDataItem.mock.calls[0][2] as Record<string, unknown>;
    expect(written.dateOfCremation).toBe('07/15/2026');
    const changed = Object.keys(written).filter((k) => k in original && JSON.stringify(written[k]) !== JSON.stringify(original[k]));
    expect(changed.filter((k) => !['dateOfCremation', 'revision', '_updatedDate', 'updatedAt'].includes(k))).toEqual([]);
    const scheduled = vi.mocked(runAfterResponse).mock.calls.find(([label]) => String(label).startsWith('official documents'));
    expect(scheduled).toBeDefined();
    await (scheduled![1] as () => Promise<unknown>)();
    const [before, after] = regenerateOfficialDocumentsSpy.mock.calls[0] as unknown as [{ dateOfCremation: string | null }, { dateOfCremation: string | null; tagNumber: string | null }];
    expect(before.dateOfCremation).toBeNull();
    expect(after).toMatchObject({ dateOfCremation: '07/15/2026', tagNumber: 'T-1042' });
  });

  it('a Date of Cremation in the future is refused, as from the Schedule tab', async () => {
    mockAdminQueries(stage3CaseData({}));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { dateOfCremation: '12/31/2099' } });
    expect(response.status).toBe(422);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('a manual stage change records when the case entered the new stage, in the same write', async () => {
    mockAdminQueries(stage3CaseData({}));
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { rawStage: 4 } });
    const written = mockUpdateWixDataItem.mock.calls[0][2] as Record<string, unknown>;
    expect(written.currentStage).toBe(4);
    expect(typeof written.stageEnteredAt).toBe('string');
  });

  it('B. Stage 3 with every Stage 3 requirement, including Hardsave, explicitly satisfied advances to Stage 4 — and the SAME response already reflects it', async () => {
    mockAdminQueries(stage3CaseData({ 0: true, 1: true, 2: true }));
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '0:0': true, '2:0': true, '2:1': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true } },
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
    mockAdminQueries(stage3CaseData({ 0: true, 1: true, 2: true }));
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '0:0': true, '2:0': true, '2:1': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true } },
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
      patch: { checklistState: { '0:0': true, '2:0': true, '2:1': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true } },
    };

    // First request: Stage 3 -> Stage 4, mirroring test B exactly.
    mockAdminQueries(stage3CaseData({ 0: true, 1: true, 2: true }));
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
    // Task #6 suite's stage3CaseData pattern above) the mocked "existing"
    // data must already reflect the post-patch checklistState, not the
    // pre-patch one, or reconciliation re-reads stale state. Permit has 2
    // items, and the checklist default-done fix (2026-10) means both now
    // need an explicit composite key — not just the stage's last one.
    mockAdminQueries(permitStageCaseData({ '3:0': true, '3:1': true }));
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '3:1': true } } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.rawStage).toBe(5);
  });

  it('11. classifying a case as a Medical Examiner case triggers reconciliation', async () => {
    // Medical Examiner classification (2026-10). The classification
    // changes WHICH items a stage requires, so it changes whether the
    // stage is complete. Without it in COMPLETION_AFFECTING_FIELDS the
    // toggle saved but the case never moved — staff ticked the box and
    // nothing happened.
    mockAdminQueries({ ...permitStageCaseData({ '3:0': true, '3:1': true }), isMedicalExaminerCase: true });
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { isMedicalExaminerCase: true },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.isMedicalExaminerCase).toBe(true);
    expect(body.case.rawStage).toBe(5);
  });

  it('11c. an ME case can tick its verification items, which the frozen snapshot does not contain', async () => {
    // The whole reported symptom: the checklist presented the three
    // verification items and the write validator refused every one, because
    // indices 3-5 of the EDRS stage are not in the snapshot. Rendering and
    // writing must agree, or staff classify a case and nothing moves.
    mockAdminQueries({
      ...permitStageCaseData({}),
      currentStage: 3,
      isMedicalExaminerCase: true,
    });
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '2:3': true } },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.checklistState['2:3']).toBe(true);
  });

  it('11d. a standard case still cannot write the ME indices', async () => {
    mockAdminQueries({ ...permitStageCaseData({}), currentStage: 3, isMedicalExaminerCase: false });
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '2:3': true } },
    });
    expect(response.status).toBe(400);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('11e. classifying and ticking in ONE patch is judged against the post-patch classification', async () => {
    // A single request can do both. The tick must be validated against the
    // items the case will present once this patch lands, not the ones it
    // presented before it.
    mockAdminQueries({ ...permitStageCaseData({}), currentStage: 3, isMedicalExaminerCase: false });
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { isMedicalExaminerCase: true, checklistState: { '2:3': true } },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.checklistState['2:3']).toBe(true);
  });

  it('11b. un-classifying also triggers reconciliation, in the same way', async () => {
    // Symmetry matters: clearing the box restores the doctor items, which
    // can leave an earlier stage incomplete again. That must be reflected
    // too, not silently ignored.
    mockAdminQueries({ ...permitStageCaseData({ '3:0': true, '3:1': true }), isMedicalExaminerCase: false });
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { isMedicalExaminerCase: false },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.isMedicalExaminerCase).toBe(false);
    expect(body.case.rawStage).toBe(5);
  });
});

/**
 * Archived cases are read-only, and Restore works (2026-10).
 *
 * The PATCH route used to look the case up with `isArchived: false`, so an
 * archived case 404'd on every write — including the restore meant to
 * un-archive it. Reading is now allowed (see the GET suite above) and the
 * restriction is explicit: one permitted write, and only one.
 */
describe('PATCH /api/cases/[caseId] — archived cases', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  function mockArchived(extra: Record<string, unknown> = {}) {
    mockWixQueries([
      {
        id: '1042',
        dataCollectionId: 'cases',
        data: { ...EXISTING_WIX_CASE_DATA, isArchived: true, archivedAt: '2026-10-01T00:00:00.000Z', ...extra },
      },
    ]);
    mockUpdateWixDataItem.mockImplementation((_c: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  }

  it('refuses an ordinary edit with 409 and persists nothing', async () => {
    mockArchived();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { decedentName: 'SOMEONE ELSE' },
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/archived/i);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('refuses a checklist tick on an archived case', async () => {
    mockArchived();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { checklistState: { '0:0': true } },
    });
    expect(response.status).toBe(409);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('allows the restore, so a filed case can be brought back', async () => {
    mockArchived();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { isDeleted: false },
    });
    expect(response.status).toBe(200);
    const persisted = mockUpdateWixDataItem.mock.calls.at(-1)![2] as Record<string, unknown>;
    expect(persisted.isArchived).toBe(false);
  });

  it('refuses a restore that carries an edit with it', async () => {
    mockArchived();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { isDeleted: false, decedentName: 'SOMEONE ELSE' },
    });
    expect(response.status).toBe(409);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('leaves live cases completely unaffected', async () => {
    mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: { ...EXISTING_WIX_CASE_DATA, isArchived: false } }]);
    mockUpdateWixDataItem.mockImplementation((_c: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { placeOfDeath: 'ST. MARY\'S HOSPITAL' },
    });
    expect(response.status).toBe(200);
  });
});

describe('PATCH /api/cases/[caseId] — contact instructions (2026-10)', () => {
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

  function activityEvents() {
    return mockInsertWixDataItem.mock.calls
      .filter(([collectionId]) => collectionId === 'activityEvents')
      .map(([, data]) => data as Record<string, unknown>);
  }

  it('records who added a contact restriction and when, as its own readable event', async () => {
    mockAdminQueries();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { doNotContactNextOfKin: true, arrangementContactName: 'Michael Ellison' },
    });

    expect(response.status).toBe(200);
    const restriction = activityEvents().find((e) => e.eventType === 'case.contact_restriction.changed');
    expect(restriction).toBeDefined();
    expect(restriction?.description).toBe('Do not contact next of kin directly — restriction added.');
    // "including who changed contact restrictions and when" — the actor
    // and the timestamp both travel on the event envelope.
    expect(restriction?.actorIdentityId).toBe(mockDefaultUser.id);
    expect(restriction?.caseId).toBe('1042');
    expect(restriction?.createdAt ?? restriction?.occurredAt).toBeTruthy();
  });

  it('flags removal of a restriction at warning severity', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, doNotContactNextOfKin: true });
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { doNotContactNextOfKin: false },
    });

    expect(response.status).toBe(200);
    const restriction = activityEvents().find((e) => e.eventType === 'case.contact_restriction.changed');
    expect(restriction?.description).toBe('Do not contact next of kin directly — restriction removed.');
    // Lifting the restriction is the direction that can lead to an
    // unwanted call, so it is the direction a reviewer must be able to find.
    expect(restriction?.severity).toBe('warning');
  });

  it('does not double-report the restriction in the generic case.updated diff', async () => {
    mockAdminQueries();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { doNotContactNextOfKin: true } });

    const generic = activityEvents().filter((e) => e.eventType === 'case.updated');
    expect(generic.every((e) => !String(e.description).includes('doNotContactNextOfKin'))).toBe(true);
    expect(activityEvents().filter((e) => e.eventType === 'case.contact_restriction.changed')).toHaveLength(1);
  });

  it('emits no restriction event when the flag is re-sent unchanged', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, doNotContactNextOfKin: true });
    await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { doNotContactNextOfKin: true, contactInstructions: 'Call after 6pm.' },
    });

    expect(activityEvents().filter((e) => e.eventType === 'case.contact_restriction.changed')).toHaveLength(0);
  });

  it('a legacy case ticking the box for the first time registers as a real change', async () => {
    // EXISTING_WIX_CASE_DATA has no doNotContactNextOfKin column at all —
    // the comparison must treat absent as false rather than as
    // "undefined !== true, therefore noise".
    mockAdminQueries();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { doNotContactNextOfKin: true } });

    expect(activityEvents().filter((e) => e.eventType === 'case.contact_restriction.changed')).toHaveLength(1);
  });

  it('persists the arrangement contact without disturbing the legal next of kin', async () => {
    mockAdminQueries();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: {
        doNotContactNextOfKin: true,
        arrangementContactName: 'Michael Ellison',
        arrangementContactRelationship: 'Son',
        arrangementContactPhone: '(555) 886-1190',
        arrangementContactEmail: 'michael@example.com',
        contactInstructions: 'All calls after 6pm. Do not leave voicemail.',
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.arrangementContactName).toBe('MICHAEL ELLISON');
    expect(body.case.contactInstructions).toBe('All calls after 6pm. Do not leave voicemail.');
    // The legal contact of record is untouched by any of this.
    expect(body.case.nextOfKinName).toBe(EXISTING_WIX_CASE_DATA.nextOfKinName);
    expect(body.case.nextOfKinPhone).toBe(EXISTING_WIX_CASE_DATA.nextOfKinPhone);
  });

  it('an unrelated edit cannot erase a recorded restriction', async () => {
    mockAdminQueries({
      ...EXISTING_WIX_CASE_DATA,
      doNotContactNextOfKin: true,
      arrangementContactName: 'MICHAEL ELLISON',
      contactInstructions: 'All calls after 6pm.',
    });
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { weight: '180 lb' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.doNotContactNextOfKin).toBe(true);
    expect(body.case.arrangementContactName).toBe('MICHAEL ELLISON');
    expect(body.case.contactInstructions).toBe('All calls after 6pm.');
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith(
      'cases',
      '1042',
      expect.objectContaining({ doNotContactNextOfKin: true, arrangementContactName: 'MICHAEL ELLISON' }),
    );
    expect(activityEvents().filter((e) => e.eventType === 'case.contact_restriction.changed')).toHaveLength(0);
  });

  it('rejects the whole request rather than partially applying a malformed contact payload', async () => {
    mockAdminQueries();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { doNotContactNextOfKin: 'yes', contactInstructions: 'Call after 6pm.' },
    });

    expect(response.status).toBe(400);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/cases/[caseId] — terminal family-pickup release (2026-10)', () => {
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

  /** Exactly what ChecklistCard's "Record family pickup" dialog sends. */
  const DIALOG_PATCH = {
    pickupStatus: 'released',
    pickupReleasedTo: 'Karen Ellison',
    pickupReleasedAt: '07/10/2026',
    pickupNote: 'Photo ID checked',
  };

  it('accepts the dialog payload and persists a complete release record', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, currentStage: 7, returnMethod: 'pickup' });
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: DIALOG_PATCH });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.pickupStatus).toBe('released');
    expect(body.case.pickupReleasedTo).toBe('KAREN ELLISON');
    expect(body.case.pickupReleasedAt).toBe('07/10/2026');
    // The persisted record is what a reload reads back — completion is
    // derived from these fields, so it survives refresh by construction.
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith(
      'cases',
      '1042',
      expect.objectContaining({ pickupStatus: 'released', pickupReleasedTo: 'KAREN ELLISON', pickupReleasedAt: '07/10/2026' }),
    );
  });

  it('never advances the workflow stage as a side effect of recording the release', async () => {
    // The release completes the terminal item; it must not also push
    // rawStage, which is reconciliation's job alone.
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, currentStage: 7, returnMethod: 'pickup' });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: DIALOG_PATCH });

    const persisted = mockUpdateWixDataItem.mock.calls[0][2] as Record<string, unknown>;
    expect(persisted.currentStage).toBe(7);
  });

  it('a release missing its documentation is refused at the persistence chokepoint', async () => {
    // The dialog's Save button cannot produce this, but a direct API call
    // can — the invariant must hold regardless of which door is used.
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, currentStage: 7, returnMethod: 'pickup' });
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { pickupStatus: 'released' },
    });

    // 422, not 400: the payload is well-formed and correctly typed, but
    // the resulting record would violate the release invariant.
    expect(response.status).toBe(422);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('recording the release leaves checklistState untouched — no second completion signal is written', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, currentStage: 7, returnMethod: 'pickup' });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: DIALOG_PATCH });

    const persisted = mockUpdateWixDataItem.mock.calls[0][2] as Record<string, unknown>;
    expect(persisted.checklistState).toEqual(EXISTING_WIX_CASE_DATA.checklistState);
  });
});

describe('PATCH /api/cases/[caseId] — archive / restore (2026-10)', () => {
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

  function activityEvents() {
    return mockInsertWixDataItem.mock.calls
      .filter(([collectionId]) => collectionId === 'activityEvents')
      .map(([, data]) => data as Record<string, unknown>);
  }

  it('archiving sets only isArchived and deletes nothing', async () => {
    mockAdminQueries();
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDeleted: true } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.isDeleted).toBe(true);

    const persisted = mockUpdateWixDataItem.mock.calls[0][2] as Record<string, unknown>;
    expect(persisted.isArchived).toBe(true);
    // Everything that makes the case a record survives untouched.
    expect(persisted.caseNumber).toBe(EXISTING_WIX_CASE_DATA.caseNumber);
    expect(persisted.currentStage).toBe(EXISTING_WIX_CASE_DATA.currentStage);
    expect(persisted.checklistState).toEqual(EXISTING_WIX_CASE_DATA.checklistState);
    expect(persisted.decedentName).toBe(EXISTING_WIX_CASE_DATA.decedentName);
  });

  it('records who archived the case and when, at warning severity', async () => {
    mockAdminQueries();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDeleted: true } });

    const event = activityEvents().find((e) => e.eventType === 'case.archived');
    expect(event).toBeDefined();
    expect(event?.description).toMatch(/No data was deleted/);
    expect(event?.severity).toBe('warning');
    expect(event?.actorIdentityId).toBe(mockDefaultUser.id);
    expect(event?.caseId).toBe('1042');
  });

  it('restoring emits case.restored and clears the flag', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, isArchived: true });
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDeleted: false } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.isDeleted).toBe(false);
    const event = activityEvents().find((e) => e.eventType === 'case.restored');
    expect(event).toBeDefined();
    expect(event?.severity).toBe('info');
  });

  it('does not double-report the archive in the generic case.updated diff', async () => {
    mockAdminQueries();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDeleted: true } });

    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(1);
    const generic = activityEvents().filter((e) => e.eventType === 'case.updated');
    expect(generic.every((e) => !String(e.description).includes('isDeleted'))).toBe(true);
  });

  it('re-sending the same archive state emits no event', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, isArchived: true });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isDeleted: true } });
    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(0);
  });

  it('an unrelated edit never archives a case by accident', async () => {
    mockAdminQueries();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { weight: '180 lb' } });

    const persisted = mockUpdateWixDataItem.mock.calls[0][2] as Record<string, unknown>;
    expect(persisted.isArchived).toBe(EXISTING_WIX_CASE_DATA.isArchived);
    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(0);
  });
});

describe('PATCH /api/cases/[caseId] — automatic archiving (2026-10)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  /**
   * A case sitting at the terminal stage, awaiting family pickup. Carries
   * a REAL workflow snapshot: completion is judged against the case's own
   * template, so the shared fixture's empty `stages: []` has no terminal
   * stage to reach and could never complete.
   */
  const REAL_SNAPSHOT = buildCaseWorkflowSnapshot(
    standardCremationWorkflowTemplateFixture,
    latestTemplateVersion(standardCremationWorkflowTemplateFixture),
  );
  const TERMINAL_AWAITING = {
    ...EXISTING_WIX_CASE_DATA,
    workflowSnapshot: REAL_SNAPSHOT,
    currentStage: 7,
    returnMethod: 'pickup',
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
  };

  function mockAdminQueries(caseData: Record<string, unknown>) {
    mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: caseData }]);
    mockUpdateWixDataItem.mockImplementation((_c: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  }

  function activityEvents() {
    return mockInsertWixDataItem.mock.calls
      .filter(([collectionId]) => collectionId === 'activityEvents')
      .map(([, data]) => data as Record<string, unknown>);
  }

  /** The final persisted state across every write this request made. */
  function lastPersisted() {
    return mockUpdateWixDataItem.mock.calls.at(-1)![2] as Record<string, unknown>;
  }

  it('archives automatically when the family pickup completes the case', async () => {
    mockAdminQueries(TERMINAL_AWAITING);
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.isDeleted).toBe(true);
    const persisted = lastPersisted();
    expect(persisted.isArchived).toBe(true);
    expect(typeof persisted.archivedAt).toBe('string');
    // Nothing about the case itself was lost or rewritten.
    expect(persisted.caseNumber).toBe(EXISTING_WIX_CASE_DATA.caseNumber);
    expect(persisted.currentStage).toBe(7);
    expect(persisted.pickupReleasedTo).toBe('KAREN ELLISON');
  });

  it('attributes the archive to SOLIS, never to the staff member who recorded the pickup', async () => {
    mockAdminQueries(TERMINAL_AWAITING);
    await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' },
    });

    const archived = activityEvents().filter((e) => e.eventType === 'case.archived');
    expect(archived).toHaveLength(1);
    expect(archived[0].isSystemGenerated).toBe(true);
    expect(archived[0].actorIdentityId).toBeNull();
  });

  it('archives on confirmed shipping delivery, but NOT on dispatch', async () => {
    mockAdminQueries({ ...TERMINAL_AWAITING, returnMethod: 'shipping', shippingDeliveryStatus: null });
    await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { shippingDeliveryStatus: 'shipped' },
    });
    expect(lastPersisted().isArchived).toBeFalsy();
    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(0);

    mockUpdateWixDataItem.mockClear();
    mockInsertWixDataItem.mockClear();
    mockAdminQueries({ ...TERMINAL_AWAITING, returnMethod: 'shipping', shippingDeliveryStatus: 'shipped' });
    await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { shippingDeliveryStatus: 'delivered' },
    });
    expect(lastPersisted().isArchived).toBe(true);
  });

  it('does not archive an incomplete case', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, workflowSnapshot: REAL_SNAPSHOT, currentStage: 3 });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { weight: '180 lb' } });

    expect(lastPersisted().isArchived).toBeFalsy();
    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(0);
  });

  it('crematory release earlier in the workflow does not archive', async () => {
    // pickupStatus released while still at an earlier stage is the
    // crematory handing remains to the funeral home, not the family.
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, workflowSnapshot: REAL_SNAPSHOT, currentStage: 5, returnMethod: 'pickup' });
    await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' },
    });

    expect(lastPersisted().isArchived).toBeFalsy();
  });

  it('never re-archives an already-complete case, so no existing case is backfilled', async () => {
    // B2026-035's shape: complete BEFORE this edit, so there is no
    // transition and nothing to archive.
    mockAdminQueries({
      ...TERMINAL_AWAITING,
      pickupStatus: 'released',
      pickupReleasedTo: 'Karen Ellison',
      pickupReleasedAt: '07/10/2026',
      isArchived: false,
    });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { weight: '180 lb' } });

    expect(lastPersisted().isArchived).toBe(false);
    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(0);
  });

  it('a restored case is not immediately re-archived by a later edit', async () => {
    // Restored: isArchived false, but the case is still complete. The next
    // edit sees complete -> complete, which is not a transition.
    mockAdminQueries({
      ...TERMINAL_AWAITING,
      pickupStatus: 'released',
      pickupReleasedTo: 'Karen Ellison',
      pickupReleasedAt: '07/10/2026',
      isArchived: false,
      archivedAt: null,
    });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { pickupNote: 'corrected' } });

    expect(lastPersisted().isArchived).toBe(false);
    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(0);
  });

  it('emits exactly one archive event for one completing transition', async () => {
    mockAdminQueries(TERMINAL_AWAITING);
    await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { pickupStatus: 'released', pickupReleasedTo: 'Karen Ellison', pickupReleasedAt: '07/10/2026' },
    });
    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(1);
  });

  it('an already-archived case is left alone', async () => {
    mockAdminQueries({ ...TERMINAL_AWAITING, isArchived: true });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { pickupNote: 'note' } });
    expect(activityEvents().filter((e) => e.eventType === 'case.archived')).toHaveLength(0);
  });
});

describe('PATCH /api/cases/[caseId] — Medical Examiner classification (2026-10)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
  });

  function mockAdminQueries(caseData: Record<string, unknown> = EXISTING_WIX_CASE_DATA) {
    mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: caseData }]);
    mockUpdateWixDataItem.mockImplementation((_c: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  }

  it('persists the classification and audits the change', async () => {
    mockAdminQueries();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { isMedicalExaminerCase: true },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.case.isMedicalExaminerCase).toBe(true);
    expect(mockUpdateWixDataItem.mock.calls.at(-1)![2]).toMatchObject({ isMedicalExaminerCase: true });

    const updated = mockInsertWixDataItem.mock.calls
      .filter(([c]) => c === 'activityEvents')
      .map(([, d]) => d as Record<string, unknown>)
      .filter((e) => e.eventType === 'case.updated');
    expect(updated.some((e) => String(e.description).includes('isMedicalExaminerCase'))).toBe(true);
  });

  it('rejects a non-boolean classification', async () => {
    mockAdminQueries();
    const response = await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      patch: { isMedicalExaminerCase: 'yes' },
    });
    expect(response.status).toBe(400);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('turning the classification off never erases checklist history', async () => {
    const withBoth = {
      ...EXISTING_WIX_CASE_DATA,
      isMedicalExaminerCase: true,
      checklistState: { '2:0': true, '2:3': true, '2:4': true },
    };
    mockAdminQueries(withBoth);
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { isMedicalExaminerCase: false } });

    const persisted = mockUpdateWixDataItem.mock.calls.at(-1)![2] as Record<string, unknown>;
    expect(persisted.checklistState).toEqual(withBoth.checklistState);
  });

  it('an unrelated edit never changes the classification', async () => {
    mockAdminQueries({ ...EXISTING_WIX_CASE_DATA, isMedicalExaminerCase: true });
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { tagNumber: 'T-4' } });
    expect(mockUpdateWixDataItem.mock.calls.at(-1)![2]).toMatchObject({ isMedicalExaminerCase: true });
  });
});

describe('GET /api/cases/[caseId] — tenant-isolation hardening (2026-10)', () => {
  const GUS_ORGANIZATION_ID = 'gus-camacho-jr';

  afterEach(() => {
    delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
    const membershipIndex = mockMembershipFixtures.findIndex((m) => m.organizationId === GUS_ORGANIZATION_ID && m.userId === mockDefaultUser.id);
    if (membershipIndex !== -1) mockMembershipFixtures.splice(membershipIndex, 1);
    const organizationIndex = mockOrganizationFixtures.findIndex((o) => o.id === GUS_ORGANIZATION_ID);
    if (organizationIndex !== -1) mockOrganizationFixtures.splice(organizationIndex, 1);
  });

  it('a mock-source session is rejected (401) on wix data before any case query', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockWixQueries();
    mockSession = { user: mockDefaultUser };

    const response = await requestFor('1042', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(401);
    expect(mockQueryWixDataItems).not.toHaveBeenCalledWith('cases', expect.anything());
  });

  it('the Gus deployment (DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr) cannot read a managed-cremations case by id, even for an administrator of both', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS_ORGANIZATION_ID;
    mockOrganizationFixtures.push({ id: GUS_ORGANIZATION_ID, name: 'Gus Camacho Jr. Funeral Home', isActive: true });
    mockMembershipFixtures.push({ organizationId: GUS_ORGANIZATION_ID, userId: mockDefaultUser.id, role: 'administrator', isActive: true });
    mockSession = fixtureIdentitySession(mockDefaultUser);
    // Filter-honoring 'cases' lookup: the Manors case row exists in the
    // shared backend and is only ever returned for its own organization.
    mockWixQueries();
    const baseImplementation = mockQueryWixDataItems.getMockImplementation()!;
    mockQueryWixDataItems.mockImplementation((collectionId: string, options?: { filter?: Record<string, unknown> }) => {
      if (collectionId === 'cases') {
        const matches = options?.filter?.organizationId === DEFAULT_ORGANIZATION_ID && options?.filter?.beaconCaseId === '1042';
        return Promise.resolve({ dataItems: matches ? [{ id: '1042', dataCollectionId: 'cases', data: EXISTING_WIX_CASE_DATA }] : [] });
      }
      return baseImplementation(collectionId, options);
    });

    // Explicitly requesting the Manors organization: generic 403, no case query at all.
    const explicit = await requestFor('1042', DEFAULT_ORGANIZATION_ID);
    expect(explicit.status).toBe(403);
    expect(mockQueryWixDataItems).not.toHaveBeenCalledWith('cases', expect.anything());

    // Requesting the Gus organization: authorized, but the query is scoped
    // to gus-camacho-jr, so the Manors case is simply not found.
    const viaGus = await requestFor('1042', GUS_ORGANIZATION_ID);
    expect(viaGus.status).toBe(404);
    for (const call of mockQueryWixDataItems.mock.calls.filter(([collectionId]) => collectionId === 'cases')) {
      expect(call[1]?.filter?.organizationId).toBe(GUS_ORGANIZATION_ID);
    }
  });
});

/**
 * Case concurrency (2026-10, docs/CASE_CONCURRENCY.md). The PATCH route's
 * revision contract — the same one Gus SOLIS answers on the shared rows.
 */
const CONCURRENCY_CASE_DATA = {
  ...EXISTING_WIX_CASE_DATA,
  workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, latestTemplateVersion(standardCremationWorkflowTemplateFixture)),
};

describe('PATCH /api/cases/[caseId] — case revisions and concurrency', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    // The real template snapshot, so checklist keys are validated against
    // real items.
    mockWixQueries([{ id: '1042', dataCollectionId: 'cases', data: CONCURRENCY_CASE_DATA }]);
    mockUpdateWixDataItem.mockImplementation((_c: string, itemId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }),
    );
  });

  const save = (patch: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    rawPatchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch, ...extra });
  const conflictEvents = () =>
    mockInsertWixDataItem.mock.calls
      .filter(([collectionId]) => collectionId === 'activityEvents')
      .map(([, data]) => data as Record<string, unknown>)
      .filter((data) => data.eventType === 'case.update.conflict');

  it('refuses a save with no revision (428, reason revision_required) and writes nothing', async () => {
    const response = await save({ weight: '180 lb' });
    expect(response.status).toBe(428);
    expect((await response.json()).reason).toBe('revision_required');
    expect(conditionalPatchCalls).toHaveLength(0);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a malformed revision with 400', async () => {
    expect((await save({ weight: '180 lb' }, { expectedRevision: -1 })).status).toBe(400);
    expect((await save({ weight: '180 lb' }, { expectedRevision: '1' })).status).toBe(400);
    expect(conditionalPatchCalls).toHaveLength(0);
  });

  it('accepts the revision from an If-Match header', async () => {
    const response = await rawPatchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { weight: '180 lb' } }, { 'if-match': 'W/"0"' });
    expect(response.status).toBe(200);
  });

  it('legacy case (no revision): conditioned on $eq null, organization and case id; ends at revision 1', async () => {
    const response = await save({ weight: '180 lb' }, { expectedRevision: 0 });
    expect(response.status).toBe(200);
    expect(conditionalPatchCalls[0].condition.filter).toEqual({
      organizationId: { $eq: DEFAULT_ORGANIZATION_ID },
      beaconCaseId: { $eq: CONCURRENCY_CASE_DATA.beaconCaseId },
      revision: { $eq: null },
    });
    expect((await response.json()).case.revision).toBe(1);
  });

  it('is field-scoped: only the changed field and the revision are written', async () => {
    await save({ weight: '180 lb' }, { expectedRevision: 0 });
    expect(Object.keys(conditionalPatchCalls[0].fields).sort()).toEqual(['revision', 'weight']);
  });

  it('two staff editing from the same revision: the second is refused with 409 and the current case; the first survives', async () => {
    const first = await save({ placeOfDeath: 'Home' }, { expectedRevision: 0 });
    expect(first.status).toBe(200);

    const second = await save({ placeOfDeath: 'Hospital' }, { expectedRevision: 0 });
    const body = await second.json();
    expect(second.status).toBe(409);
    expect(body.reason).toBe('revision_conflict');
    expect(body.currentRevision).toBe(1);
    expect(body.case.placeOfDeath).toBe('HOME');
    expect(writtenCaseRows.get('1042')!.placeOfDeath).toBe('HOME');
  });

  it('audits a refused save with field NAMES only, never the unsaved values', async () => {
    await save({ placeOfDeath: 'Home' }, { expectedRevision: 0 });
    await save({ placeOfDeath: 'Hospital' }, { expectedRevision: 0 });
    const events = conflictEvents();
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].metadata as string)).toEqual({ expectedRevision: 0, currentRevision: 1, fields: ['placeOfDeath'] });
    expect(JSON.stringify(events[0])).not.toContain('Hospital');
    expect(JSON.stringify(events[0])).not.toContain('HOSPITAL');
  });

  it('independent checklist ticks from the same page revision both land', async () => {
    const a = await save({ checklistState: { '0:8': true } }, { expectedRevision: 0, baseValues: { checklistState: { '0:8': null } } });
    const b = await save({ checklistState: { '0:10': true } }, { expectedRevision: 0, baseValues: { checklistState: { '0:10': null } } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const stored = writtenCaseRows.get('1042')!.checklistState as Record<string, boolean>;
    expect(stored['0:8']).toBe(true);
    expect(stored['0:10']).toBe(true);
  });

  it('a conflicting change to the SAME checklist item from a stale page is refused', async () => {
    await save({ checklistState: { '0:8': true } }, { expectedRevision: 0, baseValues: { checklistState: { '0:8': null } } });
    const stale = await save({ checklistState: { '0:8': false } }, { expectedRevision: 0, baseValues: { checklistState: { '0:8': null } } });
    expect(stale.status).toBe(409);
    expect((writtenCaseRows.get('1042')!.checklistState as Record<string, boolean>)['0:8']).toBe(true);
  });

  it('a payment recorded meanwhile is never undone by a stale staff save', async () => {
    // markCasePaidIfVerified landed after the staff page loaded (revision 1).
    writtenCaseRows.set('1042', {
      ...CONCURRENCY_CASE_DATA,
      paymentStatus: 'paid_in_full',
      checklistState: { '0:8': true },
      revision: 1,
    });
    // An unrelated field edit from the stale page: refused, payment intact.
    expect((await save({ weight: '180 lb' }, { expectedRevision: 0 })).status).toBe(409);
    // A checklist tick on a different item: lands, and the payment tick stays.
    const tick = await save({ checklistState: { '0:3': true } }, { expectedRevision: 0, baseValues: { checklistState: { '0:3': null } } });
    expect(tick.status).toBe(200);
    const stored = writtenCaseRows.get('1042')!;
    expect(stored.paymentStatus).toBe('paid_in_full');
    expect((stored.checklistState as Record<string, boolean>)['0:8']).toBe(true);
  });

  it('a retried save that already landed answers 200 and writes nothing more (no duplicate write)', async () => {
    await save({ weight: '180 lb' }, { expectedRevision: 0 });
    const writesBefore = conditionalPatchCalls.length;
    const retry = await save({ weight: '180 lb' }, { expectedRevision: 0 });
    expect(retry.status).toBe(200);
    expect(conditionalPatchCalls).toHaveLength(writesBefore);
  });

  it('never changes the case number or any untouched field', async () => {
    await save({ weight: '180 lb' }, { expectedRevision: 0 });
    const stored = writtenCaseRows.get('1042')!;
    expect(stored.caseNumber).toBe(CONCURRENCY_CASE_DATA.caseNumber);
    expect(stored.currentStage).toBe(CONCURRENCY_CASE_DATA.currentStage);
    expect(stored.checklistState).toEqual(CONCURRENCY_CASE_DATA.checklistState);
  });

  it('another organization\'s case is 404 and nothing is written, even with a valid revision', async () => {
    mockSession = fixtureIdentitySession(mockMultiOrgUser);
    mockWixQueries([]);
    const response = await rawPatchRequest('1042', { organizationId: SECOND_MOCK_ORGANIZATION_ID, patch: { weight: '1' }, expectedRevision: 0 });
    expect(response.status).toBe(404);
    expect(conditionalPatchCalls).toHaveLength(0);
  });
});

describe('PATCH /api/cases/[caseId] — historical checklist corrections (2026-10)', () => {
  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    syncExpectedPickupSpy.mockClear();
    earlierStageStatus.override = null;
  });
  afterEach(() => {
    earlierStageStatus.override = null;
  });

  const SNAPSHOT = buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, standardCremationWorkflowTemplateFixture.versions[0]);
  /** A case at raw stage 3 (display stage 2) — stages 0 and 1 are earlier. */
  function mockStage3Case(extra: Record<string, unknown> = {}) {
    mockWixQueries([
      {
        id: '1042',
        dataCollectionId: 'cases',
        data: {
          ...EXISTING_WIX_CASE_DATA,
          currentStage: 3,
          workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
          workflowTemplateVersion: standardCremationWorkflowTemplateFixture.versions[0].version,
          workflowSnapshot: SNAPSHOT,
          fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X', 9: 'X', 10: 'X' },
          checklistState: { '0:0': true, '0:8': true, '0:9': true, '0:10': true },
          ...extra,
        },
      },
    ]);
    mockUpdateWixDataItem.mockImplementation((_c: string, itemId: string, data: Record<string, unknown>) => Promise.resolve({ id: itemId, dataCollectionId: 'cases', data }));
  }
  const writtenCompletions = () =>
    (mockUpdateWixDataItem.mock.calls[0][2] as { checklistCompletions: Record<string, Record<string, unknown>> }).checklistCompletions;
  const activityTypes = () => mockInsertWixDataItem.mock.calls.filter(([c]) => c === 'activityEvents').map(([, data]) => (data as { eventType: string }).eventType);

  it('an earlier-stage change is saved, attributed, flagged historical by the server — and the case stays where it is', async () => {
    mockStage3Case();
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '0:8': false } } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.case.rawStage).toBe(3);
    expect(body.case.checklistState['0:8']).toBe(false);
    expect(writtenCompletions()['0:8']).toMatchObject({ done: false, method: 'manual', actorId: mockDefaultUser.id, historical: true });
    expect(Date.parse(writtenCompletions()['0:8'].at as string)).not.toBeNaN();
  });

  it('asks the expected-pickup sync for the receipt step only — never to create or re-date a pickup', async () => {
    mockStage3Case();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '1:0': true } } });
    expect(syncExpectedPickupSpy).toHaveBeenCalledTimes(1);
    expect(syncExpectedPickupSpy.mock.calls[0][0]).toMatchObject({ receiptOnly: true });
  });

  it('a save that also changes a current-stage step keeps ordinary pickup scheduling — only the earlier key is flagged', async () => {
    mockStage3Case();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '0:8': false, '2:0': true } } });
    expect(syncExpectedPickupSpy.mock.calls[0][0]).toMatchObject({ receiptOnly: false });
    expect(writtenCompletions()['0:8']).toMatchObject({ historical: true });
    expect(writtenCompletions()['2:0']).not.toHaveProperty('historical');
  });

  it('a non-checklist save after a correction syncs as usual', async () => {
    mockStage3Case();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { fieldValues: { 3: '160 lb' } } });
    for (const [params] of syncExpectedPickupSpy.mock.calls) expect(params).toMatchObject({ receiptOnly: false });
  });

  it('is recorded in the activity log as a correction, alongside the usual case update', async () => {
    mockStage3Case();
    await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '0:8': false } } });
    expect(activityTypes()).toEqual(expect.arrayContaining(['case.updated', 'case.checklist_corrected']));
    const corrected = mockInsertWixDataItem.mock.calls.find(([, data]) => (data as { eventType: string }).eventType === 'case.checklist_corrected')![1] as {
      description: string;
      newValue: string;
    };
    expect(corrected.description).toMatch(/^Earlier step corrected: unchecked "/);
    expect(JSON.parse(corrected.newValue)).toMatchObject({ historicalCorrection: true, changes: [{ key: '0:8', done: false }] });
  });

  it('a client cannot claim or deny a correction — only the stored stage decides', async () => {
    mockStage3Case();
    await patchRequest('1042', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      historical: false,
      patch: { checklistState: { '0:8': false }, checklistCompletions: { '0:8': { done: false, historical: false } } },
    });
    expect(writtenCompletions()['0:8']).toMatchObject({ historical: true, method: 'manual' });
  });

  it('an ordinary current-stage update is unchanged: no correction flag, a normal pickup sync, no correction event', async () => {
    mockStage3Case();
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '2:0': true } } });
    expect(response.status).toBe(200);
    expect(writtenCompletions()['2:0']).not.toHaveProperty('historical');
    expect(syncExpectedPickupSpy.mock.calls[0][0]).toMatchObject({ receiptOnly: false });
    expect(activityTypes()).not.toContain('case.checklist_corrected');
  });

  it('without true earlier-stage status (any organization but Manors) the server refuses earlier-stage changes and writes nothing', async () => {
    earlierStageStatus.override = false;
    mockStage3Case();
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '0:8': false } } });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    // The current stage is still editable, exactly as before.
    const current = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '2:0': true } } });
    expect(current.status).toBe(200);
  });

  it('an archived case refuses a correction like any other edit', async () => {
    mockStage3Case({ isArchived: true, archivedAt: '2026-10-01T00:00:00.000Z' });
    const response = await patchRequest('1042', { organizationId: DEFAULT_ORGANIZATION_ID, patch: { checklistState: { '0:8': false } } });
    expect(response.status).toBe(409);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });
});
