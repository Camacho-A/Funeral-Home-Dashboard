import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAllCaseDataRows, exportAllCaseDataCsv, exportAllCaseDataXlsx, ALL_CASE_DATA_COLUMNS } from './allCaseDataReportService';
import { caseFixtures } from './__mocks__/fixtures';
import { caseOrderFixtures } from './__mocks__/pricingFixtures';
import { caseDocumentFixtures } from './__mocks__/documentFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { Case } from '../types/case';

/**
 * Manors cleanup phase (Task #8, "All Case Data" report). Covers the row-
 * building logic directly — date filtering, financial-column gating, and
 * the staff/documents joins — complementing (not duplicating)
 * `app/api/reports/all-case-data/export/route.test.ts`'s end-to-end
 * auth/Content-Type/export-format coverage over the already-seeded demo
 * data. Uses its own isolated test case, pushed/popped per test, so
 * nothing here depends on the real seed data's current shape.
 */
const TEST_CASE_ID = 'case-all-data-test';

function testCase(overrides: Partial<Case> = {}): Case {
  return {
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-900',
    decedentName: 'Eleanor Vance',
    dateOfBirth: '01/01/1940',
    dateOfDeath: '06/01/2026',
    timeOfDeath: '',
    placeOfDeath: '',
    weight: '150 lb',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: 'Paul Vance',
    nextOfKinPhone: '(555) 777-1111',
    nextOfKinEmail: null,
    nextOfKinRelationship: 'son',
    nextOfKinRelationshipOther: null,
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    tagNumber: 'T-900',
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
    checklistState: {},
    fieldValues: {},
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: 'undecided',
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
    daysWaitingInStage: 3,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    isDeleted: false,
    workflowTemplateId: 'template-standard-cremation',
    workflowTemplateVersion: 1,
    caseType: 'cremation',
    workflowSnapshot: null,
    ...overrides,
  };
}

let caseLen: number;
let orderLen: number;
let docLen: number;

beforeEach(() => {
  caseLen = caseFixtures.length;
  orderLen = caseOrderFixtures.length;
  docLen = caseDocumentFixtures.length;
});

afterEach(() => {
  caseFixtures.length = caseLen;
  caseOrderFixtures.length = orderLen;
  caseDocumentFixtures.length = docLen;
});

describe('buildAllCaseDataRows', () => {
  it('includes basic case/decedent/NOK fields for a case in range', async () => {
    caseFixtures.push(testCase());
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, {}, false, 'mock');
    const row = rows.find((r) => r.caseNumber === 'B2026-900');
    expect(row).toBeDefined();
    expect(row?.decedentName).toBe('Eleanor Vance');
    expect(row?.nextOfKinName).toBe('Paul Vance');
    expect(row?.nextOfKinRelationship).toBe('Son');
    expect(row?.tagNumber).toBe('T-900');
    expect(row?.stage).toBe('First Call & Payment');
  });

  it('filters by case creation date — excludes a case created before fromDate', async () => {
    caseFixtures.push(testCase({ createdAt: '2026-01-01T00:00:00.000Z' }));
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, { fromDate: '2026-06-01' }, false, 'mock');
    expect(rows.some((r) => r.caseNumber === 'B2026-900')).toBe(false);
  });

  it('filters by case creation date — excludes a case created after toDate', async () => {
    caseFixtures.push(testCase({ createdAt: '2026-12-01T00:00:00.000Z' }));
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, { toDate: '2026-06-01' }, false, 'mock');
    expect(rows.some((r) => r.caseNumber === 'B2026-900')).toBe(false);
  });

  it('includes a case created exactly on the fromDate/toDate boundary (inclusive range)', async () => {
    caseFixtures.push(testCase({ createdAt: '2026-06-01T08:00:00.000Z' }));
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, { fromDate: '2026-06-01', toDate: '2026-06-01' }, false, 'mock');
    expect(rows.some((r) => r.caseNumber === 'B2026-900')).toBe(true);
  });

  it('leaves financial columns blank when includeFinancial is false, even with an active order', async () => {
    caseFixtures.push(testCase());
    caseOrderFixtures.push({
      id: 'order-900',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      status: 'active',
      subtotal: 89000,
      discountTotal: 0,
      taxTotal: 0,
      total: 89000,
      balanceDue: 89000,
      version: 1,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, {}, false, 'mock');
    const row = rows.find((r) => r.caseNumber === 'B2026-900');
    expect(row?.orderTotal).toBe('');
    expect(row?.balanceDue).toBe('');
    expect(row?.paymentStatus).toBe('');
  });

  it('populates financial columns from the active case order when includeFinancial is true', async () => {
    caseFixtures.push(testCase());
    caseOrderFixtures.push({
      id: 'order-901',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      status: 'active',
      subtotal: 89000,
      discountTotal: 0,
      taxTotal: 0,
      total: 89000,
      balanceDue: 25000,
      version: 1,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, {}, true, 'mock');
    const row = rows.find((r) => r.caseNumber === 'B2026-900');
    expect(row?.orderTotal).toBe('$890.00');
    expect(row?.balanceDue).toBe('$250.00');
    expect(row?.paymentStatus).not.toBe('');
  });

  it('reports "No case order" for payment status when financial columns are included but no order exists', async () => {
    caseFixtures.push(testCase());
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, {}, true, 'mock');
    const row = rows.find((r) => r.caseNumber === 'B2026-900');
    expect(row?.paymentStatus).toBe('No case order');
  });

  it('resolves assignedStaffId to the staff member\'s display name, not a raw id', async () => {
    caseFixtures.push(testCase({ assignedStaffId: 'staff-dana' }));
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, {}, false, 'mock');
    const row = rows.find((r) => r.caseNumber === 'B2026-900');
    expect(row?.assignedStaffName).toBe('Dana');
  });

  it('summarizes document count and signed count for the case', async () => {
    caseFixtures.push(testCase());
    caseDocumentFixtures.push(
      {
        id: 'doc-900a',
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: TEST_CASE_ID,
        origin: 'uploaded',
        documentTypeKey: null,
        category: null,
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1,
        checksumSha256: 'x',
        storageKey: 'k1',
        status: 'active',
        templateId: null,
        templateVersion: null,
        version: null,
        supersedesId: null,
        signatureStatus: 'signed',
        familyVisible: false,
        generatedBy: null,
        uploadedBy: 'identity-manors-admin',
        createdAt: '2026-06-01T12:00:00.000Z',
        correlationId: 'corr-900a',
      },
      {
        id: 'doc-900b',
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: TEST_CASE_ID,
        origin: 'uploaded',
        documentTypeKey: null,
        category: null,
        fileName: 'b.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1,
        checksumSha256: 'x',
        storageKey: 'k2',
        status: 'active',
        templateId: null,
        templateVersion: null,
        version: null,
        supersedesId: null,
        signatureStatus: 'unsigned',
        familyVisible: false,
        generatedBy: null,
        uploadedBy: 'identity-manors-admin',
        createdAt: '2026-06-01T12:00:00.000Z',
        correlationId: 'corr-900b',
      },
    );
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, {}, false, 'mock');
    const row = rows.find((r) => r.caseNumber === 'B2026-900');
    expect(row?.documentsSummary).toBe('2 documents · 1 signed');
  });

  it('never includes a case belonging to a different organization', async () => {
    caseFixtures.push(testCase({ id: 'other-org-case', caseNumber: 'B2026-901', organizationId: 'evergreen-memorial-group' }));
    const rows = await buildAllCaseDataRows(DEFAULT_ORGANIZATION_ID, {}, false, 'mock');
    expect(rows.some((r) => r.caseNumber === 'B2026-901')).toBe(false);
  });
});

describe('exportAllCaseDataCsv', () => {
  it('produces a header row matching every declared column, in order', () => {
    const csv = exportAllCaseDataCsv([]);
    expect(csv).toBe(ALL_CASE_DATA_COLUMNS.map((c) => c.header).join(','));
  });

  it('produces one data row per case, values in the same column order as the header', () => {
    const csv = exportAllCaseDataCsv([
      {
        caseNumber: 'B2026-900',
        stage: 'First Call & Payment',
        createdAt: '06/01/2026',
        daysInStage: '3',
        decedentName: 'Eleanor Vance',
        dateOfBirth: '01/01/1940',
        dateOfDeath: '06/01/2026',
        nextOfKinName: 'Paul Vance',
        nextOfKinRelationship: 'Son',
        nextOfKinPhone: '(555) 777-1111',
        nextOfKinEmail: '',
        tagNumber: 'T-900',
        pickupStatus: 'Awaiting Pickup',
        returnMethod: 'Undecided',
        assignedStaffName: '',
        isVeteran: 'No',
        documentsSummary: '0 documents',
        orderTotal: '',
        balanceDue: '',
        paymentStatus: '',
      },
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('B2026-900');
    expect(lines[1]).toContain('Eleanor Vance');
  });
});

describe('exportAllCaseDataXlsx', () => {
  it('produces a real zip (.xlsx) buffer', async () => {
    const buffer = await exportAllCaseDataXlsx([]);
    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');
  });
});
