import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockOfficeStaffUser, mockManagerUser } from '@/services/__mocks__/authFixtures';

/**
 * B2026-034 incident recovery (2026-09). `DEFAULT_ORGANIZATION_ID`
 * ('managed-cremations') is used throughout — this route is hardcoded to
 * exactly that organization and exactly one Case row, so these tests
 * exercise the real hard-scoping/fingerprint gates rather than a stand-in.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

let mockQueryWixDataItems = vi.fn();
let mockGetWixDataItemById = vi.fn();
let mockUpdateWixDataItem = vi.fn();
let mockInsertWixDataItem = vi.fn();
vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  class WixDataApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'WixDataApiError';
      this.status = status;
    }
  }
  return {
    WixDataApiError,
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    queryAllWixDataItems: async (collectionId: string, filter?: Record<string, unknown>) => {
      getWixServerConfig();
      const response = await mockQueryWixDataItems(collectionId, { filter });
      return response.dataItems;
    },
    getWixDataItemById: (...args: unknown[]) => {
      getWixServerConfig();
      return mockGetWixDataItemById(...args);
    },
    updateWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockUpdateWixDataItem(...args);
    },
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
    deleteWixDataItem: vi.fn(),
    incrementWixDataField: vi.fn(),
  };
});

const { GET, POST } = await import('./route');

const TARGET_CASE_WIX_ITEM_ID = '9d058cf4-9149-40ab-8c1c-4257a6c9b1f2';
const TARGET_CASE_NUMBER = 'B2026-034';
const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function getRequest(organizationId: string | null) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  return GET(new Request(`http://localhost/api/admin/incident-recovery/b2026-034?${params.toString()}`));
}

function postRequest(body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return POST(new Request('http://localhost/api/admin/incident-recovery/b2026-034', { method: 'POST', headers, body: JSON.stringify(body) }));
}

const ADMIN_ROLE_ITEM = {
  id: 'role-administrator',
  dataCollectionId: 'roles',
  data: { beaconRoleId: 'role-administrator', key: 'administrator', name: 'Administrator', description: 'x', organizationId: null, isSystemDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
};
const ADMIN_MANAGE_ROLES_PERMISSION_ITEM = {
  id: 'rp-manage-roles',
  dataCollectionId: 'rolePermissions',
  data: { beaconRolePermissionId: 'rp-manage-roles', roleId: 'role-administrator', permissionKey: 'user.manageRoles', createdAt: '2026-01-01T00:00:00.000Z' },
};

/** Seeds the RBAC read path to grant `user.manageRoles` (Administrator) to
    whichever user is currently signed in via mockSession. */
function seedAdministratorPermission() {
  mockQueryWixDataItems.mockImplementation((collectionId: string) => {
    if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMIN_ROLE_ITEM] });
    if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: [ADMIN_MANAGE_ROLES_PERMISSION_ITEM] });
    return Promise.resolve({ dataItems: [] });
  });
}

/** Grants zero permissions — used for the "non-admin denied" cases (an
    authenticated, in-org user who simply lacks user.manageRoles). */
function seedNoPermissions() {
  mockQueryWixDataItems.mockImplementation(() => Promise.resolve({ dataItems: [] }));
}

const DAMAGED_CASE_DATA = {
  fieldValues: {},
  workflowSnapshot: { workflowTemplateId: 'workflow-template-standard-cremation', workflowTemplateVersion: 3, intake: { sections: [] }, stages: [] },
  // No caseNumber, no organizationId — exactly what the destructive write left behind.
};

const RESTORED_ALREADY_CASE_DATA = {
  caseNumber: TARGET_CASE_NUMBER,
  organizationId: DEFAULT_ORGANIZATION_ID,
  fieldValues: { '0': 'X', '1': 'X', '2': 'X', '4': 'X', '7': 'X' },
  workflowSnapshot: { workflowTemplateId: 'workflow-template-standard-cremation', workflowTemplateVersion: 3, intake: { sections: [] }, stages: [{ rawStage: 0, checklist: { items: [{ index: 8, hasField: false }, { index: 9, hasField: false }, { index: 10, hasField: false }] } }] },
  checklistState: { '8': true },
};

function seedTargetCase(data: Record<string, unknown> | null) {
  mockGetWixDataItemById.mockImplementation((collectionId: string, itemId: string) => {
    if (collectionId === 'cases' && itemId === TARGET_CASE_WIX_ITEM_ID) {
      return Promise.resolve(data ? { id: itemId, dataCollectionId: collectionId, data } : null);
    }
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'wix';
  process.env.WIX_API_KEY = 'test-key';
  process.env.WIX_SITE_ID = 'test-site';
  mockSession = { user: mockDefaultUser };
  mockQueryWixDataItems = vi.fn().mockResolvedValue({ dataItems: [] });
  mockGetWixDataItemById = vi.fn().mockResolvedValue(null);
  mockUpdateWixDataItem = vi.fn();
  mockInsertWixDataItem = vi.fn();
  seedAdministratorPermission();
  seedTargetCase(DAMAGED_CASE_DATA);
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  vi.clearAllMocks();
});

describe('GET /api/admin/incident-recovery/b2026-034', () => {
  it('1. requires Administrator authorization to even read eligibility', async () => {
    mockSession = { user: mockOfficeStaffUser };
    seedNoPermissions();
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('2. a non-admin (real role, no user.manageRoles) is denied', async () => {
    mockSession = { user: mockManagerUser };
    seedNoPermissions();
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('reports matchesDamagedStateFingerprint: true against the seeded damaged row', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.caseNumber).toBe(TARGET_CASE_NUMBER);
    expect(body.matchesDamagedStateFingerprint).toBe(true);
  });

  it('5. reports matchesDamagedStateFingerprint: false against an already-restored row (no write on GET regardless)', async () => {
    seedTargetCase(RESTORED_ALREADY_CASE_DATA);
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.matchesDamagedStateFingerprint).toBe(false);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('GET never mutates anything', async () => {
    await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
    expect(mockInsertWixDataItem).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/incident-recovery/b2026-034', () => {
  it('1. requires Administrator authorization to execute', async () => {
    mockSession = { user: mockOfficeStaffUser };
    seedNoPermissions();
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('2. a non-admin (real role, no user.manageRoles) is denied and performs no write', async () => {
    mockSession = { user: mockManagerUser };
    seedNoPermissions();
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      { origin: 'https://evil.example.com', host: 'localhost', 'Content-Type': 'application/json' },
    );
    expect(response.status).toBe(403);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('3. is hard-scoped to the one known Case — an attacker-supplied caseId in the body is ignored entirely', async () => {
    mockUpdateWixDataItem.mockImplementation((collectionId: string, itemId: string, data: unknown) => Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }));
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'some-other-case-id', replacementData: { anything: 'ignored' } });
    expect(mockGetWixDataItemById).toHaveBeenCalledWith('cases', TARGET_CASE_WIX_ITEM_ID);
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith('cases', TARGET_CASE_WIX_ITEM_ID, expect.anything());
  });

  it('4/5. damaged-state fingerprint required — a healthy/already-restored Case returns 409 and causes no write', async () => {
    seedTargetCase(RESTORED_ALREADY_CASE_DATA);
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.restored).toBe(false);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('4. a Case record that no longer exists at all also fails the precondition (409, no write)', async () => {
    seedTargetCase(null);
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(409);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  describe('a successful restoration write', () => {
    async function runSuccessfulRestoration() {
      mockUpdateWixDataItem.mockImplementation((collectionId: string, itemId: string, data: unknown) => Promise.resolve({ id: itemId, dataCollectionId: collectionId, data }));
      const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
      const body = await response.json();
      return { response, body };
    }

    it('6. sends the complete last-known-good business field set, not a partial patch', async () => {
      await runSuccessfulRestoration();
      const [, , sentData] = mockUpdateWixDataItem.mock.calls[0] as [string, string, Record<string, unknown>];
      for (const field of [
        'caseNumber', 'organizationId', 'currentStage', 'checklistState', 'decedentName', 'placeOfDeath',
        'dateOfBirth', 'dateOfDeath', 'timeOfDeath', 'weight', 'nextOfKinName', 'nextOfKinPhone', 'paymentStatus',
        'isVeteran', 'vaStepsState', 'workflowTemplateId', 'workflowTemplateVersion', 'tagNumber', 'caseHandlerId',
        'returnMethod', 'isStalled', 'isArchived', 'daysWaitingInStage', 'intakeOwnerId', 'createdAt', 'createdBy',
        'caseType', 'beaconCaseId', 'fieldValues', 'workflowSnapshot',
      ]) {
        expect(sentData, `expected restored payload to include "${field}"`).toHaveProperty(field);
      }
      expect(sentData.caseNumber).toBe(TARGET_CASE_NUMBER);
      expect(sentData.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    });

    it('7. fieldValues 0/1/2/4/7 are restored (non-empty)', async () => {
      await runSuccessfulRestoration();
      const [, , sentData] = mockUpdateWixDataItem.mock.calls[0] as [string, string, { fieldValues: Record<string, string> }];
      for (const index of ['0', '1', '2', '4', '7']) {
        expect(sentData.fieldValues[index]).toEqual(expect.any(String));
        expect(sentData.fieldValues[index].length).toBeGreaterThan(0);
      }
    });

    it('8. fieldValues 3/5/6 remain absent (never fabricated)', async () => {
      await runSuccessfulRestoration();
      const [, , sentData] = mockUpdateWixDataItem.mock.calls[0] as [string, string, { fieldValues: Record<string, string> }];
      for (const index of ['3', '5', '6']) {
        expect(sentData.fieldValues[index]).toBeUndefined();
      }
    });

    it('9/11. workflowSnapshot raw-stage-0 checklist indices 8/9/10 all have hasField: false, and are never marked complete in checklistState', async () => {
      await runSuccessfulRestoration();
      const [, , sentData] = mockUpdateWixDataItem.mock.calls[0] as [string, string, { workflowSnapshot: { stages: Array<{ rawStage: number; checklist: { items: Array<{ index: number; hasField: boolean }> } }> }; checklistState: Record<string, boolean> }];
      const stage0 = sentData.workflowSnapshot.stages.find((s) => s.rawStage === 0)!;
      for (const index of [8, 9, 10]) {
        expect(stage0.checklist.items.find((i) => i.index === index)?.hasField).toBe(false);
      }
      expect(sentData.checklistState['9']).toBeUndefined();
      expect(sentData.checklistState['10']).toBeUndefined();
    });

    it('10. checklistState[8] is restored to true', async () => {
      await runSuccessfulRestoration();
      const [, , sentData] = mockUpdateWixDataItem.mock.calls[0] as [string, string, { checklistState: Record<string, boolean> }];
      expect(sentData.checklistState['8']).toBe(true);
    });

    it('12. post-write verification reports fullyRestored: true and never returns raw field values', async () => {
      const { response, body } = await runSuccessfulRestoration();
      expect(response.status).toBe(200);
      expect(body.restored).toBe(true);
      expect(body.verification.fullyRestored).toBe(true);
      expect(body.verification.missingFields).toEqual([]);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/LOUIS BARBER|TAINA LOPEZ|7400 SW|954.*899.5296/);
    });

    it('records a sanitized case.incident_recovery.performed activity event with no PII', async () => {
      await runSuccessfulRestoration();
      const activityCall = mockInsertWixDataItem.mock.calls.find((call) => call[0] === 'activityEvents');
      expect(activityCall).toBeTruthy();
      const eventData = activityCall![1] as Record<string, unknown>;
      expect(eventData.eventType).toBe('case.incident_recovery.performed');
      expect(eventData.newValue).toContain('succeeded');
      expect(JSON.stringify(eventData)).not.toMatch(/LOUIS BARBER|TAINA LOPEZ|7400 SW/);
    });

    it('17. a second invocation after a successful restoration cannot write again (409, idempotent)', async () => {
      await runSuccessfulRestoration();
      expect(mockUpdateWixDataItem).toHaveBeenCalledTimes(1);
      // Simulate the now-restored row for the follow-up call.
      const [, , restoredData] = mockUpdateWixDataItem.mock.calls[0];
      seedTargetCase(restoredData as Record<string, unknown>);

      const secondResponse = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
      expect(secondResponse.status).toBe(409);
      expect(mockUpdateWixDataItem).toHaveBeenCalledTimes(1); // still only the one call from before
    });

    it('16. never mutates any caseDocuments/payments/orders/financial collection', async () => {
      await runSuccessfulRestoration();
      const forbiddenCollections = ['caseDocuments', 'payments', 'orders', 'financialTransactions', 'generalLedgerEntries'];
      for (const call of [...mockUpdateWixDataItem.mock.calls, ...mockInsertWixDataItem.mock.calls]) {
        expect(forbiddenCollections).not.toContain(call[0]);
      }
    });

    it('14. never queries or mutates caseSequences', async () => {
      await runSuccessfulRestoration();
      for (const call of [...mockUpdateWixDataItem.mock.calls, ...mockInsertWixDataItem.mock.calls, ...mockGetWixDataItemById.mock.calls, ...mockQueryWixDataItems.mock.calls]) {
        expect(call[0]).not.toBe('caseSequences');
      }
    });
  });

  it('rejects when DATA_ADAPTER is not wix', async () => {
    process.env.DATA_ADAPTER = 'mock';
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(400);
    expect(mockUpdateWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects an invalid JSON body', async () => {
    const response = await POST(new Request('http://localhost/api/admin/incident-recovery/b2026-034', { method: 'POST', headers: SAME_ORIGIN_HEADERS, body: '{not json' }));
    expect(response.status).toBe(400);
  });

  it('rejects a missing organizationId', async () => {
    const response = await postRequest({});
    expect(response.status).toBe(400);
  });
});

/** 13/15. Structural guarantees — this route module must never even
    IMPORT the workflow-reconciliation entry point or any Jotform
    integration module, regardless of what any mock could otherwise permit
    at runtime. Source-inspection is the right tool here (rather than
    "assert a mocked function wasn't called"), since these modules are never
    imported at all — there is no mock to assert against.
    Deliberately scoped to only the file's `import ... from '...'` lines
    (not the whole file) — the route's own doc comments legitimately
    *discuss* reconciliation/Jotform in prose (explaining what this route
    does NOT do), and the restored Case data legitimately contains the real
    business fact that raw stage 2 is labeled "Jotform Application" — none
    of that should trip a "never talks to Jotform" guarantee. */
describe('structural guarantees', () => {
  const source = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
  const importLines = source
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line))
    .join('\n');

  it('13. never imports reconcileCaseWorkflow / workflowReconciliationService', () => {
    expect(importLines).not.toMatch(/reconcileCaseWorkflow/);
    expect(importLines).not.toMatch(/workflowReconciliationService/);
  });

  it('15. never imports any Jotform integration/webhook module', () => {
    expect(importLines).not.toMatch(/jotform/i);
    expect(importLines).not.toMatch(/externalFormSubmissionService/);
  });

  it('never imports wixCaseNumberSequence (no caseSequences allocation capability at all)', () => {
    expect(importLines).not.toMatch(/wixCaseNumberSequence/);
  });

  it('never imports documentService/paymentWorkflow/financial services', () => {
    expect(importLines).not.toMatch(/documentService|paymentWorkflow|financialTransactionService|generalLedgerService/);
  });

  it('does not accept caseId, organizationId (beyond the auth check), or replacement data as effective input', () => {
    // The only field ever read off the request body is `organizationId`,
    // and only to run the standard requireAuthorizedOrganization check —
    // never to select which Case row to touch.
    expect(source).toMatch(/b\.organizationId/);
    expect(source).not.toMatch(/b\.caseId/);
    expect(source).not.toMatch(/b\.data\b/);
    expect(source).not.toMatch(/b\.replacementData/);
  });
});
