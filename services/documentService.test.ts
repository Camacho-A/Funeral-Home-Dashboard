import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRenderHtmlToPdf = vi.fn();
const mockUploadFile = vi.fn();
const mockDownloadFile = vi.fn();
const mockDeleteFile = vi.fn();

vi.mock('../lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: (...args: unknown[]) => mockRenderHtmlToPdf(...args) },
}));
vi.mock('../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: (...args: unknown[]) => mockUploadFile(...args),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
    deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  },
}));

const { list, generate, upload, archive, downloadFile, markDocumentSigned, setFamilyVisible, DocumentServiceError } = await import('./documentService');
const { createTemplate } = await import('./documentTemplatesService');
const { caseDocumentFixtures } = await import('./__mocks__/documentFixtures');
const { documentTemplateFixtures } = await import('./__mocks__/documentFixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { caseFixtures } = await import('./__mocks__/fixtures');
const { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
type ActivityContext = {
  organizationId: string;
  actorIdentityId: string | null;
  actorMembershipId: string | null;
  actorRoleKey: string | null;
  correlationId: string;
};

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `doc-${idCounter}`;
}

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'manager',
    correlationId: 'corr-1',
    ...overrides,
  };
}

const TEST_CASE_ID = 'case-doc-service-test';

let lengths: { docs: number; templates: number; events: number; cases: number };
beforeEach(() => {
  idCounter = 0;
  vi.clearAllMocks();
  mockRenderHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake pdf content'));
  mockUploadFile.mockImplementation(async (key: string) => ({ storageKey: key }));
  mockDownloadFile.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 fake pdf content'), contentType: 'application/pdf' });

  lengths = { docs: caseDocumentFixtures.length, templates: documentTemplateFixtures.length, events: activityEventFixtures.length, cases: caseFixtures.length };
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-999',
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
  caseDocumentFixtures.length = lengths.docs;
  documentTemplateFixtures.length = lengths.templates;
  activityEventFixtures.length = lengths.events;
  caseFixtures.length = lengths.cases;
});

async function createSampleTemplate() {
  return createTemplate(
    {
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: 'Cremation Authorization',
      documentTypeKey: 'authorization.cremation',
      category: 'authorization',
      body: '<p>Dear {{case.primaryContact.fullName}}, re: {{case.decedent.fullName}}.</p>',
      idFactory,
    },
    ctx(),
    'mock',
  );
}

describe('generate', () => {
  it('renders, uploads, and persists an active document; records document.generated', async () => {
    const template = await createSampleTemplate();
    const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    expect(doc.status).toBe('active');
    expect(doc.origin).toBe('generated');
    expect(doc.templateId).toBe(template.id);
    expect(doc.templateVersion).toBe(1);
    expect(doc.version).toBe(1);
    expect(doc.checksumSha256).toHaveLength(64);
    expect(doc.fileSizeBytes).toBeGreaterThan(0);
    expect(mockRenderHtmlToPdf).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);

    const recorded = activityEventFixtures.at(-1);
    expect(recorded?.eventType).toBe('document.generated');
    expect(recorded?.correlationId).toBe('corr-1');
  });

  it('the merged HTML actually resolves the case data into the rendered content', async () => {
    const template = await createSampleTemplate();
    await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    const renderedHtml = mockRenderHtmlToPdf.mock.calls[0][0] as string;
    expect(renderedHtml).toContain('Margaret Ellison');
    expect(renderedHtml).toContain('Robert Ellison');
  });

  it('regeneration supersedes the prior document and increments version, recording document.regenerated', async () => {
    const template = await createSampleTemplate();
    const first = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    const second = await generate({ caseId: TEST_CASE_ID, templateId: template.id, existingDocumentId: first.id, idFactory }, ctx(), 'mock');

    expect(second.version).toBe(2);
    expect(second.supersedesId).toBe(first.id);
    expect(second.status).toBe('active');

    const documents = await list(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'mock');
    const firstReloaded = documents.find((d) => d.id === first.id);
    expect(firstReloaded?.status).toBe('superseded');
    expect(firstReloaded?.storageKey).toBe(first.storageKey); // content untouched, only status changed

    const recorded = activityEventFixtures.at(-1);
    expect(recorded?.eventType).toBe('document.regenerated');
  });

  it('regeneration can explicitly target the same template version (not just "latest")', async () => {
    const template = await createSampleTemplate();
    const first = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    const second = await generate({ caseId: TEST_CASE_ID, templateId: template.id, existingDocumentId: first.id, templateVersion: 1, idFactory }, ctx(), 'mock');
    expect(second.templateVersion).toBe(1);
  });

  it('throws for an unrecognized template version', async () => {
    const template = await createSampleTemplate();
    await expect(generate({ caseId: TEST_CASE_ID, templateId: template.id, templateVersion: 99, idFactory }, ctx(), 'mock')).rejects.toThrow(DocumentServiceError);
  });

  it('a render failure marks the pending row failed, never leaves it ambiguously pending, and never records document.generated', async () => {
    mockRenderHtmlToPdf.mockRejectedValue(new Error('chromium crashed'));
    const template = await createSampleTemplate();

    await expect(generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock')).rejects.toThrow(DocumentServiceError);

    const documents = await list(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'mock');
    expect(documents).toHaveLength(1);
    expect(documents[0].status).toBe('failed');
    expect(activityEventFixtures.some((e) => e.eventType === 'document.generated')).toBe(false);
  });

  it('never returns/lists another organization\'s documents', async () => {
    const template = await createSampleTemplate();
    await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    const otherOrgList = await list(SECOND_MOCK_ORGANIZATION_ID, TEST_CASE_ID, 'mock');
    expect(otherOrgList).toHaveLength(0);
  });

  it('Phase 26: refuses to regenerate a signed document — completed signatures permanently lock it', async () => {
    const template = await createSampleTemplate();
    const first = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');
    await markDocumentSigned(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, first.id, 'mock');

    await expect(
      generate({ caseId: TEST_CASE_ID, templateId: template.id, existingDocumentId: first.id, idFactory }, ctx(), 'mock'),
    ).rejects.toThrow(/permanently locked/i);

    // The signed original is untouched — never flipped to superseded, never modified.
    const documents = await list(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'mock');
    const reloaded = documents.find((d) => d.id === first.id);
    expect(reloaded?.status).toBe('active');
    expect(reloaded?.signatureStatus).toBe('signed');
  });

  it('Phase 26: regenerating an unsigned document is unaffected by the signed-document lock', async () => {
    const template = await createSampleTemplate();
    const first = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    const second = await generate({ caseId: TEST_CASE_ID, templateId: template.id, existingDocumentId: first.id, idFactory }, ctx(), 'mock');
    expect(second.status).toBe('active');
  });
});

describe('markDocumentSigned', () => {
  it('flips signatureStatus to signed without touching any other field', async () => {
    const template = await createSampleTemplate();
    const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');
    expect(doc.signatureStatus).toBeNull();

    await markDocumentSigned(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, 'mock');

    const documents = await list(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'mock');
    const reloaded = documents.find((d) => d.id === doc.id);
    expect(reloaded?.signatureStatus).toBe('signed');
    expect(reloaded?.status).toBe('active');
    expect(reloaded?.storageKey).toBe(doc.storageKey);
    expect(reloaded?.checksumSha256).toBe(doc.checksumSha256);
  });

  it('throws for a document that does not exist in this case/organization', async () => {
    await expect(markDocumentSigned(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'no-such-doc', 'mock')).rejects.toThrow(DocumentServiceError);
  });
});

describe('Phase 29: familyVisible', () => {
  it('every newly generated document defaults to familyVisible: false', async () => {
    const template = await createSampleTemplate();
    const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');
    expect(doc.familyVisible).toBe(false);
  });

  it('every newly uploaded document defaults to familyVisible: false', async () => {
    const doc = await upload({ caseId: TEST_CASE_ID, fileName: 'scan.pdf', mimeType: 'application/pdf', idFactory }, Buffer.from('raw bytes'), ctx(), 'mock');
    expect(doc.familyVisible).toBe(false);
  });

  it('setFamilyVisible is the only way the field ever flips to true, without touching any other field', async () => {
    const template = await createSampleTemplate();
    const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    const updated = await setFamilyVisible(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, true, 'mock');
    expect(updated.familyVisible).toBe(true);
    expect(updated.status).toBe('active');
    expect(updated.storageKey).toBe(doc.storageKey);
  });

  it('setFamilyVisible can also flip a document back to family-hidden', async () => {
    const template = await createSampleTemplate();
    const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');
    await setFamilyVisible(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, true, 'mock');

    const updated = await setFamilyVisible(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, false, 'mock');
    expect(updated.familyVisible).toBe(false);
  });

  it('throws for a document that does not exist in this case/organization', async () => {
    await expect(setFamilyVisible(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'no-such-doc', true, 'mock')).rejects.toThrow(DocumentServiceError);
  });
});

describe('upload', () => {
  it('uploads a file and records document.uploaded', async () => {
    const doc = await upload({ caseId: TEST_CASE_ID, fileName: 'scan.pdf', mimeType: 'application/pdf', idFactory }, Buffer.from('raw bytes'), ctx(), 'mock');
    expect(doc.origin).toBe('uploaded');
    expect(doc.status).toBe('active');
    expect(doc.checksumSha256).toHaveLength(64);
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.uploaded');
  });
});

describe('archive', () => {
  it('archives a document and records document.archived', async () => {
    const template = await createSampleTemplate();
    const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    await archive(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, ctx(), 'mock');

    const documents = await list(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'mock');
    expect(documents.find((d) => d.id === doc.id)?.status).toBe('archived');
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.archived');
  });

  it('throws for a document that does not exist in this case/organization', async () => {
    await expect(archive(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'no-such-doc', ctx(), 'mock')).rejects.toThrow(DocumentServiceError);
  });
});

describe('downloadFile', () => {
  it('fetches bytes via the storage provider and records document.downloaded', async () => {
    const template = await createSampleTemplate();
    const doc = await generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock');

    const result = await downloadFile(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, doc.id, ctx(), 'mock');
    expect(result.buffer.toString()).toContain('%PDF');
    expect(result.fileName).toBe(doc.fileName);
    expect(mockDownloadFile).toHaveBeenCalledWith(doc.storageKey);
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.downloaded');
  });

  it('refuses to download a pending or failed document', async () => {
    mockRenderHtmlToPdf.mockRejectedValue(new Error('failure'));
    const template = await createSampleTemplate();
    await expect(generate({ caseId: TEST_CASE_ID, templateId: template.id, idFactory }, ctx(), 'mock')).rejects.toThrow();

    const documents = await list(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, 'mock');
    const failedDoc = documents[0];
    await expect(downloadFile(DEFAULT_ORGANIZATION_ID, TEST_CASE_ID, failedDoc.id, ctx(), 'mock')).rejects.toThrow(DocumentServiceError);
  });
});

describe('DocumentService orchestration boundary (structural)', () => {
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

  function walk(dir: string, results: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath, results);
      } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  it('only services/documentService.ts imports the concrete renderer/storage provider modules', () => {
    const root = join(__dirname, '..');
    const allFiles = walk(root);
    const documentServicePath = join(__dirname, 'documentService.ts');
    const rendererImplPath = join(root, 'lib', 'puppeteerDocumentRenderer.ts');
    const storageImplPath = join(root, 'lib', 'vercelBlob', 'vercelBlobStorageProvider.ts');

    const importPattern = /^import .*from ['"][^'"]*(puppeteerDocumentRenderer|vercelBlobStorageProvider)['"]/m;

    const offenders = allFiles.filter((filePath) => {
      if (filePath === documentServicePath || filePath === rendererImplPath || filePath === storageImplPath) return false;
      const source = readFileSync(filePath, 'utf8');
      return importPattern.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
