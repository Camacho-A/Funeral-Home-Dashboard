import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures } from '@/services/__mocks__/pricingFixtures';
import { caseCashAdvanceItemFixtures } from '@/services/__mocks__/billingFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

let mockRenderHtmlToPdf = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
vi.mock('@/lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: (...args: unknown[]) => mockRenderHtmlToPdf(...args) },
}));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string) => ({ storageKey: key }),
    downloadFile: async () => ({ buffer: Buffer.from('fake'), contentType: 'application/pdf' }),
    deleteFile: async () => undefined,
  },
}));

const routeModule = await import('./route');
const { POST } = routeModule;
const { createCaseOrder } = await import('@/services/pricingService');

const TEST_CASE_ID = 'case-statement-route-test';
let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `statement-route-test-${idCounter}`;
}

function generateRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${TEST_CASE_ID}/billing/statement`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID }),
  });
}

async function seedOrder() {
  await createCaseOrder(
    {
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      selections: { services: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false }, merchandise: [] },
      performedBy: 'staff-1',
      idFactory,
    },
    'mock',
  );
}

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  mockRenderHtmlToPdf = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-778',
    decedentName: 'Robert Ellison',
    dateOfBirth: '04/12/1951',
    dateOfDeath: '01/02/2026',
    timeOfDeath: '',
    placeOfDeath: '',
    weight: '178 lb',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: 'Margaret Ellison',
    nextOfKinPhone: '(555) 010-1234',
    nextOfKinEmail: null,
    nextOfKinRelationship: null,
    nextOfKinRelationshipOther: null,
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    tagNumber: null,
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
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    workflowTemplateId: 'wf-1',
    workflowTemplateVersion: 1,
    caseType: 'cremation',
    workflowSnapshot: null,
  });
});

afterEach(() => {
  caseFixtures.length = caseFixtures.filter((c) => c.id !== TEST_CASE_ID).length;
  caseDocumentFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseCashAdvanceItemFixtures.length = 0;
  vi.clearAllMocks();
});

describe('POST /api/cases/[caseId]/billing/statement', () => {
  it('1: exports the approved maxDuration for this route', () => {
    expect(routeModule.maxDuration).toBe(60);
  });

  it('13: still returns 422 with the exact no-active-order message when the case has no active order', async () => {
    const response = await generateRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('This case has no active order — a statement cannot be generated until an order exists.');
  });

  it('generates successfully (201) when the case has an active order', async () => {
    await seedOrder();
    const response = await generateRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.document.status).toBe('active');
    expect(body.document.documentTypeKey).toBe('financial.statement_goods_services');
  });

  it('14: a renderer/storage failure returns the sanitized staff-readable message, never the internal error text', async () => {
    await seedOrder();
    mockRenderHtmlToPdf.mockRejectedValue(
      new Error('Failed to launch the browser process! spawn /var/task/node_modules/@sparticuz/chromium/bin/chromium ENOENT'),
    );

    const response = await generateRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Statement PDF could not be generated. Please try again.');
    expect(JSON.stringify(body)).not.toMatch(/sparticuz|chromium|ENOENT|\/var\/task|spawn/i);
  });

  it('regenerating via existingDocumentId supersedes the prior Statement (12: version increments, supersedesId correct, old -> superseded, new -> active)', async () => {
    await seedOrder();
    const first = await (await generateRequest({ organizationId: DEFAULT_ORGANIZATION_ID })).json();
    expect(first.document.version).toBe(1);

    const response = await generateRequest({ organizationId: DEFAULT_ORGANIZATION_ID, existingDocumentId: first.document.id });
    const second = await response.json();

    expect(response.status).toBe(201);
    expect(second.document.supersedesId).toBe(first.document.id);
    expect(second.document.version).toBe(2);
    expect(second.document.status).toBe('active');

    const supersededFirst = caseDocumentFixtures.find((d) => d.id === first.document.id);
    expect(supersededFirst?.status).toBe('superseded');
  });
});
