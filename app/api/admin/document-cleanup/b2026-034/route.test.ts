import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockOfficeStaffUser, mockManagerUser } from '@/services/__mocks__/authFixtures';

/**
 * B2026-034 failed-document cleanup (2026-09). `DEFAULT_ORGANIZATION_ID`
 * ('managed-cremations') is used throughout — this route is hardcoded to
 * exactly that organization and exactly one Case's documents, so these
 * tests exercise the real hard-scoping/eligibility gates rather than a
 * stand-in.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

let mockQueryWixDataItems = vi.fn();
let mockDeleteWixDataItem = vi.fn();
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
    deleteWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockDeleteWixDataItem(...args);
    },
    insertWixDataItem: vi.fn(),
    updateWixDataItem: vi.fn(),
    getWixDataItemById: vi.fn(),
    incrementWixDataField: vi.fn(),
  };
});

const { GET, POST } = await import('./route');

const TARGET_CASE_ID = '9d058cf4-9149-40ab-8c1c-4257a6c9b1f2';
const TARGET_CASE_NUMBER = 'B2026-034';
const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function getRequest(organizationId: string | null) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  return GET(new Request(`http://localhost/api/admin/document-cleanup/b2026-034?${params.toString()}`));
}

function postRequest(body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return POST(new Request('http://localhost/api/admin/document-cleanup/b2026-034', { method: 'POST', headers, body: JSON.stringify(body) }));
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

function caseDocumentItem(overrides: Partial<{
  beaconCaseDocumentId: string;
  organizationId: string;
  caseId: string;
  origin: string;
  documentTypeKey: string | null;
  category: string | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  storageKey: string;
  status: string;
  templateId: string | null;
  templateVersion: number | null;
  version: number | null;
  supersedesId: string | null;
  signatureStatus: string | null;
  familyVisible: boolean;
  generatedBy: string | null;
  uploadedBy: string | null;
  createdAt: string;
  correlationId: string | null;
}> = {}) {
  const data = {
    beaconCaseDocumentId: 'doc-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: TARGET_CASE_ID,
    origin: 'generated',
    documentTypeKey: 'financial.statement_goods_services',
    category: 'statement',
    fileName: 'Statement of Funeral Goods and Services Selected.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 0,
    checksumSha256: '',
    storageKey: '',
    status: 'failed',
    templateId: null,
    templateVersion: null,
    version: 1,
    supersedesId: null,
    signatureStatus: null,
    familyVisible: false,
    generatedBy: 'identity-1',
    uploadedBy: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
  return { id: data.beaconCaseDocumentId, dataCollectionId: 'caseDocuments', data };
}

/** Seeds RBAC (roles/administrator) and caseDocuments query responses
    together — `mockQueryWixDataItems` is the single mock backing both
    `requireAuthorizedOrganization`'s permission check and
    `documentService.list()`'s own query, dispatched by collection id. */
function seedAdministratorAnd(documents: ReturnType<typeof caseDocumentItem>[]) {
  mockQueryWixDataItems.mockImplementation((collectionId: string) => {
    if (collectionId === 'roles') return Promise.resolve({ dataItems: [ADMIN_ROLE_ITEM] });
    if (collectionId === 'rolePermissions') return Promise.resolve({ dataItems: [ADMIN_MANAGE_ROLES_PERMISSION_ITEM] });
    if (collectionId === 'caseDocuments') return Promise.resolve({ dataItems: documents });
    return Promise.resolve({ dataItems: [] });
  });
}

function seedNoPermissions() {
  mockQueryWixDataItems.mockImplementation(() => Promise.resolve({ dataItems: [] }));
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'wix';
  process.env.WIX_API_KEY = 'test-key';
  process.env.WIX_SITE_ID = 'test-site';
  mockSession = { user: mockDefaultUser };
  mockQueryWixDataItems = vi.fn().mockResolvedValue({ dataItems: [] });
  mockDeleteWixDataItem = vi.fn().mockResolvedValue(undefined);
  seedAdministratorAnd([]);
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  vi.clearAllMocks();
});

describe('GET /api/admin/document-cleanup/b2026-034', () => {
  it('1. requires Administrator authorization to even read', async () => {
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

  it('is rejected for any organization other than Manors', async () => {
    // requireAuthorizedOrganization itself is org-agnostic in mock setup here,
    // so this exercises the route's own explicit MANORS_ORGANIZATION_ID gate.
    seedAdministratorAnd([]);
    const response = await getRequest('some-other-org');
    expect([400, 403]).toContain(response.status);
  });

  it('lists a mixed set of documents, correctly identifying which are eligible for cleanup', async () => {
    const failedStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-1', status: 'failed' });
    const activeStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-active-1', status: 'active', storageKey: 'managed-cremations/case/doc-active-1.pdf' });
    const supersededStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-superseded-1', status: 'superseded', storageKey: 'managed-cremations/case/doc-superseded-1.pdf', supersedesId: null });
    const arrangementForms = caseDocumentItem({
      beaconCaseDocumentId: 'doc-arrangement-1',
      fileName: 'Arrangement Forms.pdf',
      documentTypeKey: 'arrangement_forms',
      category: 'contract',
      status: 'active',
      storageKey: 'managed-cremations/case/doc-arrangement-1.pdf',
    });
    seedAdministratorAnd([failedStatement, activeStatement, supersededStatement, arrangementForms]);

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.caseNumber).toBe(TARGET_CASE_NUMBER);
    expect(body.totalDocuments).toBe(4);
    expect(body.eligibleForCleanupCount).toBe(1);

    const failedRow = body.documents.find((d: { id: string }) => d.id === 'doc-failed-1');
    expect(failedRow.eligible).toBe(true);
    expect(failedRow.status).toBe('failed');

    const activeRow = body.documents.find((d: { id: string }) => d.id === 'doc-active-1');
    expect(activeRow.eligible).toBe(false);

    const arrangementRow = body.documents.find((d: { id: string }) => d.id === 'doc-arrangement-1');
    expect(arrangementRow.eligible).toBe(false);
  });

  it('never includes storageKey/checksum in the response — only a hasStorageKey boolean', async () => {
    const failedStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-1', status: 'failed' });
    seedAdministratorAnd([failedStatement]);

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toContain('storageKey');
    expect(raw).not.toContain('checksumSha256');
    expect(raw).toContain('hasStorageKey');
  });

  it('GET never mutates anything', async () => {
    const failedStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-1', status: 'failed' });
    seedAdministratorAnd([failedStatement]);
    await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('an Arrangement Forms row with status: failed (hypothetical) is still never marked eligible', async () => {
    const failedArrangementForms = caseDocumentItem({
      beaconCaseDocumentId: 'doc-arrangement-failed',
      fileName: 'Arrangement Forms.pdf',
      status: 'failed',
    });
    seedAdministratorAnd([failedArrangementForms]);

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.documents[0].eligible).toBe(false);
    expect(body.documents[0].reason).toMatch(/Arrangement Forms/);
  });

  it('a failed row with an unexpected non-empty storageKey is never marked eligible', async () => {
    const suspiciousFailed = caseDocumentItem({ beaconCaseDocumentId: 'doc-suspicious', status: 'failed', storageKey: 'managed-cremations/case/doc-suspicious.pdf' });
    seedAdministratorAnd([suspiciousFailed]);

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.documents[0].eligible).toBe(false);
    expect(body.documents[0].hasStorageKey).toBe(true);
    expect(body.documents[0].reason).toMatch(/storageKey/);
  });

  it('a failed row referenced by another document\'s supersedesId is never marked eligible', async () => {
    const failedButReferenced = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-referenced', status: 'failed' });
    const laterDoc = caseDocumentItem({ beaconCaseDocumentId: 'doc-later', status: 'active', storageKey: 'x', supersedesId: 'doc-failed-referenced' });
    seedAdministratorAnd([failedButReferenced, laterDoc]);

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    const row = body.documents.find((d: { id: string }) => d.id === 'doc-failed-referenced');
    expect(row.eligible).toBe(false);
    expect(row.reason).toMatch(/supersedesId/);
  });
});

describe('POST /api/admin/document-cleanup/b2026-034', () => {
  it('1. requires Administrator authorization to execute', async () => {
    mockSession = { user: mockOfficeStaffUser };
    seedNoPermissions();
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('2. a non-admin (real role, no user.manageRoles) is denied and performs no delete', async () => {
    mockSession = { user: mockManagerUser };
    seedNoPermissions();
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      { origin: 'https://evil.example.com', host: 'localhost', 'Content-Type': 'application/json' },
    );
    expect(response.status).toBe(403);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('deletes only the failed CaseDocument rows, leaving active/superseded/Arrangement Forms untouched', async () => {
    const failedStatement1 = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-1', status: 'failed' });
    const failedStatement2 = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-2', status: 'failed' });
    const activeStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-active-1', status: 'active', storageKey: 'x' });
    const supersededStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-superseded-1', status: 'superseded', storageKey: 'x' });
    const arrangementForms = caseDocumentItem({ beaconCaseDocumentId: 'doc-arrangement-1', fileName: 'Arrangement Forms.pdf', status: 'active', storageKey: 'x' });
    seedAdministratorAnd([failedStatement1, failedStatement2, activeStatement, supersededStatement, arrangementForms]);

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.deletedCount).toBe(2);
    expect(body.deletedIds.sort()).toEqual(['doc-failed-1', 'doc-failed-2']);
    expect(mockDeleteWixDataItem).toHaveBeenCalledTimes(2);
    expect(mockDeleteWixDataItem).toHaveBeenCalledWith('caseDocuments', 'doc-failed-1');
    expect(mockDeleteWixDataItem).toHaveBeenCalledWith('caseDocuments', 'doc-failed-2');
    expect(mockDeleteWixDataItem).not.toHaveBeenCalledWith('caseDocuments', 'doc-active-1');
    expect(mockDeleteWixDataItem).not.toHaveBeenCalledWith('caseDocuments', 'doc-superseded-1');
    expect(mockDeleteWixDataItem).not.toHaveBeenCalledWith('caseDocuments', 'doc-arrangement-1');
  });

  it('never deletes Arrangement Forms.pdf even if its status were somehow "failed"', async () => {
    const failedArrangementForms = caseDocumentItem({ beaconCaseDocumentId: 'doc-arrangement-failed', fileName: 'Arrangement Forms.pdf', status: 'failed' });
    seedAdministratorAnd([failedArrangementForms]);

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.deletedCount).toBe(0);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
    expect(body.skippedFailedRecords).toHaveLength(1);
    expect(body.skippedFailedRecords[0].reason).toMatch(/Arrangement Forms/);
  });

  it('refuses to delete a failed row with an unexpected non-empty storageKey and reports it', async () => {
    const suspiciousFailed = caseDocumentItem({ beaconCaseDocumentId: 'doc-suspicious', status: 'failed', storageKey: 'managed-cremations/case/doc-suspicious.pdf' });
    seedAdministratorAnd([suspiciousFailed]);

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.deletedCount).toBe(0);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
    expect(body.skippedFailedRecords).toHaveLength(1);
    expect(body.skippedFailedRecords[0].id).toBe('doc-suspicious');
    expect(body.skippedFailedRecords[0].reason).toMatch(/storageKey/);
  });

  it('never deletes a failed row that another document still references via supersedesId', async () => {
    const failedButReferenced = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-referenced', status: 'failed' });
    const laterDoc = caseDocumentItem({ beaconCaseDocumentId: 'doc-later', status: 'active', storageKey: 'x', supersedesId: 'doc-failed-referenced' });
    seedAdministratorAnd([failedButReferenced, laterDoc]);

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.deletedCount).toBe(0);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('is hard-scoped to the one known Case — an attacker-supplied caseId is ignored entirely', async () => {
    const failedStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-1', status: 'failed' });
    seedAdministratorAnd([failedStatement]);

    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'some-other-case-id' });
    expect(mockQueryWixDataItems).toHaveBeenCalledWith('caseDocuments', { filter: { organizationId: DEFAULT_ORGANIZATION_ID, caseId: TARGET_CASE_ID } });
  });

  it('is rejected when DATA_ADAPTER is not wix', async () => {
    process.env.DATA_ADAPTER = 'mock';
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(400);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('a zero-eligible-candidates case (already clean) deletes nothing and reports zero', async () => {
    const activeStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-active-1', status: 'active', storageKey: 'x' });
    seedAdministratorAnd([activeStatement]);

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.deletedCount).toBe(0);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('re-verifies eligibility fresh on POST rather than trusting a prior GET', async () => {
    const failedStatement = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-1', status: 'failed' });
    seedAdministratorAnd([failedStatement]);
    await getRequest(DEFAULT_ORGANIZATION_ID);

    // Between GET and POST, the row's eligibility changes server-side.
    const nowIneligible = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-1', status: 'active', storageKey: 'x' });
    seedAdministratorAnd([nowIneligible]);

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.deletedCount).toBe(0);
    expect(mockDeleteWixDataItem).not.toHaveBeenCalled();
  });

  it('reports a partial failure without throwing if one deletion call fails', async () => {
    const failedStatement1 = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-1', status: 'failed' });
    const failedStatement2 = caseDocumentItem({ beaconCaseDocumentId: 'doc-failed-2', status: 'failed' });
    seedAdministratorAnd([failedStatement1, failedStatement2]);
    mockDeleteWixDataItem.mockImplementation((collectionId: string, itemId: string) => {
      if (itemId === 'doc-failed-2') return Promise.reject(new Error('Simulated Wix delete failure'));
      return Promise.resolve(undefined);
    });

    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body.deletedCount).toBe(1);
    expect(body.deletedIds).toEqual(['doc-failed-1']);
    expect(body.failedDeletions).toHaveLength(1);
    expect(body.failedDeletions[0].id).toBe('doc-failed-2');
  });
});
