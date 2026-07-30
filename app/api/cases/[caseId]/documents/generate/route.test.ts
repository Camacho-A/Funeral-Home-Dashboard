import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { caseDocumentFixtures, documentTemplateFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
vi.mock('@/lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: async () => Buffer.from('%PDF-1.4 fake') },
}));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string) => ({ storageKey: key }),
    downloadFile: async () => ({ buffer: Buffer.from('fake'), contentType: 'application/pdf' }),
    deleteFile: async () => undefined,
  },
}));

const { POST } = await import('./route');
const { createTemplate } = await import('@/services/documentTemplatesService');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `case-documents-generate-route-test-${idCounter}`;
}

function generateRequest(caseId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/documents/generate`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ caseId }) });
}

const TEST_CASE_ID = 'case-generate-route-test';

beforeEach(() => {
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-777',
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
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    checklistState: {},
    fieldValues: {},
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
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  activityEventFixtures.length = 0;
  caseFixtures.length = caseFixtures.filter((c) => c.id !== TEST_CASE_ID).length;
});

async function seedTemplate() {
  return createTemplate(
    { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Cremation Authorization', documentTypeKey: 'authorization.cremation', category: 'authorization', body: '<p>{{case.decedent.fullName}}</p>', idFactory },
    { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'seed', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'seed-corr' },
    'mock',
  );
}

describe('POST /api/cases/[caseId]/documents/generate', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await generateRequest(TEST_CASE_ID, {}, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    const template = await seedTemplate();
    const response = await generateRequest(TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, templateId: template.id });
    expect(response.status).toBe(401);
  });

  it('a role without document.generate (readOnly) is refused', async () => {
    const template = await seedTemplate();
    const readOnlyUser = { id: 'mock-user-readonly-doc-test', email: 'readonly-doc@beacon.test', displayName: 'Read Only Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: readOnlyUser.id, role: 'readOnly', isActive: true });
    mockSession = { user: readOnlyUser };

    const response = await generateRequest(TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, templateId: template.id });
    expect(response.status).toBe(403);

    mockMembershipFixtures.pop();
  });

  it('returns 403 for a forged organizationId the caller has no membership in', async () => {
    const template = await seedTemplate();
    mockSession = { user: mockMultiOrgUser };
    const response = await generateRequest(TEST_CASE_ID, { organizationId: 'org-with-no-membership', templateId: template.id });
    expect(response.status).toBe(403);
  });

  it('generates a document and records document.generated', async () => {
    const template = await seedTemplate();
    const response = await generateRequest(TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, templateId: template.id });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.document.status).toBe('active');
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.generated');
  });

  it('regenerates via existingDocumentId — supersedes the prior document', async () => {
    const template = await seedTemplate();
    const first = await (await generateRequest(TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, templateId: template.id })).json();

    const response = await generateRequest(TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, templateId: template.id, existingDocumentId: first.document.id });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.document.supersedesId).toBe(first.document.id);
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.regenerated');
  });

  it('returns 404 for a nonexistent template', async () => {
    const response = await generateRequest(TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, templateId: 'no-such-template' });
    expect(response.status).toBe(404);
  });
});
