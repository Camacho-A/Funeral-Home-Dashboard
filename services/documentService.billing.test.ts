import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRenderHtmlToPdf = vi.fn();
const mockUploadFile = vi.fn();

vi.mock('../lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: (...args: unknown[]) => mockRenderHtmlToPdf(...args) },
}));
vi.mock('../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: (...args: unknown[]) => mockUploadFile(...args),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

const { generateBillingDocument, list, markDocumentSigned, DocumentServiceError } = await import('./documentService');
const { caseDocumentFixtures } = await import('./__mocks__/documentFixtures');

let n = 0;
const idFactory = () => `bdoc-${(n += 1)}`;
const ctx = { organizationId: 'org-1', actorIdentityId: 'staff-1', actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1' };

beforeEach(() => {
  n = 0;
  mockRenderHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-fake-statement'));
  mockUploadFile.mockImplementation(async (key: string) => ({ storageKey: key }));
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
  vi.clearAllMocks();
});

const params = (over: Record<string, unknown> = {}) => ({
  caseId: 'case-1',
  documentTypeKey: 'financial.statement_goods_services',
  category: 'statement' as const,
  fileName: 'Statement of Goods and Services.pdf',
  bodyHtml: '<h1>Statement</h1><p>total</p>',
  idFactory,
  ...over,
});

describe('documentService.generateBillingDocument', () => {
  it('renders the provided HTML through the shared pipeline and produces an active CaseDocument', async () => {
    const doc = await generateBillingDocument(params(), ctx, 'mock');
    expect(doc.status).toBe('active');
    expect(doc.origin).toBe('generated');
    expect(doc.documentTypeKey).toBe('financial.statement_goods_services');
    expect(doc.templateId).toBeNull(); // not a template-merge document
    expect(doc.version).toBe(1);
    expect(doc.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    // The exact provided body reached the renderer.
    expect(mockRenderHtmlToPdf).toHaveBeenCalledOnce();
    expect(String(mockRenderHtmlToPdf.mock.calls[0][0])).toContain('<h1>Statement</h1>');
  });

  it('increments version per (case, documentTypeKey) and supersedes on regeneration', async () => {
    const first = await generateBillingDocument(params(), ctx, 'mock');
    const second = await generateBillingDocument(params({ existingDocumentId: first.id }), ctx, 'mock');
    expect(second.version).toBe(2);
    const all = await list('org-1', 'case-1', 'mock');
    expect(all.find((d) => d.id === first.id)?.status).toBe('superseded');
    expect(all.find((d) => d.id === second.id)?.status).toBe('active');
  });

  it('refuses to regenerate a signed statement (permanent lock)', async () => {
    const first = await generateBillingDocument(params(), ctx, 'mock');
    await markDocumentSigned('org-1', 'case-1', first.id, 'mock');
    await expect(generateBillingDocument(params({ existingDocumentId: first.id }), ctx, 'mock')).rejects.toBeInstanceOf(DocumentServiceError);
  });

  it('marks the row failed and throws if rendering fails', async () => {
    mockRenderHtmlToPdf.mockRejectedValueOnce(new Error('chromium boom'));
    await expect(generateBillingDocument(params(), ctx, 'mock')).rejects.toBeInstanceOf(DocumentServiceError);
    const all = await list('org-1', 'case-1', 'mock');
    expect(all[0].status).toBe('failed');
  });
});

/**
 * Older versions move to History automatically (2026-10).
 *
 * Superseding only `existingDocumentId` let the Documents tab accumulate
 * several live "Statement of Funeral Goods and Services Selected"
 * entries — a caller that passed no id superseded nothing, and once two
 * were active the UI could only point at one, so the other stayed active
 * forever.
 */
describe('generateBillingDocument — supersedes every older version of its type', () => {
  const ORG = 'managed-cremations';
  const CASE_ID = 'case-supersede';

  function ctx() {
    return { organizationId: ORG, actorIdentityId: 'identity-1', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'corr-1' };
  }

  async function generate(existingDocumentId?: string) {
    return generateBillingDocument(
      {
        caseId: CASE_ID,
        documentTypeKey: 'financial.statement_goods_services',
        category: 'statement',
        fileName: 'Statement of Funeral Goods and Services Selected.pdf',
        bodyHtml: '<p>statement</p>',
        existingDocumentId,
        idFactory: () => `doc-${Math.random()}`,
      },
      ctx(),
      'mock',
    );
  }

  it('retires an earlier version even when no existingDocumentId is passed', async () => {
    const first = await generate();
    const second = await generate();

    const docs = caseDocumentFixtures.filter((d) => d.caseId === CASE_ID);
    expect(docs.find((d) => d.id === first.id)?.status).toBe('superseded');
    expect(docs.find((d) => d.id === second.id)?.status).toBe('active');
  });

  it('leaves exactly one active version however many already piled up', async () => {
    // Reproduces the state production is already in.
    await generate();
    await generate();
    await generate();

    const active = caseDocumentFixtures.filter(
      (d) => d.caseId === CASE_ID && d.documentTypeKey === 'financial.statement_goods_services' && d.status === 'active',
    );
    expect(active).toHaveLength(1);
  });

  it('never touches a different document type', async () => {
    await generate();
    const receipt = await generateBillingDocument(
      {
        caseId: CASE_ID,
        documentTypeKey: 'statement.account',
        category: 'statement',
        fileName: 'Receipt of Payment - B2026-001.pdf',
        bodyHtml: '<p>receipt</p>',
        idFactory: () => `doc-${Math.random()}`,
      },
      ctx(),
      'mock',
    );
    await generate();

    // The receipt is a different document and stays active.
    expect(caseDocumentFixtures.find((d) => d.id === receipt.id)?.status).toBe('active');
  });

  it('never touches another case', async () => {
    const other = await generateBillingDocument(
      {
        caseId: 'case-other',
        documentTypeKey: 'financial.statement_goods_services',
        category: 'statement',
        fileName: 'Statement of Funeral Goods and Services Selected.pdf',
        bodyHtml: '<p>statement</p>',
        idFactory: () => `doc-${Math.random()}`,
      },
      ctx(),
      'mock',
    );
    await generate();
    await generate();

    expect(caseDocumentFixtures.find((d) => d.id === other.id)?.status).toBe('active');
  });

  it('never supersedes a signed document', async () => {
    const signed = await generate();
    const index = caseDocumentFixtures.findIndex((d) => d.id === signed.id);
    caseDocumentFixtures[index] = { ...caseDocumentFixtures[index], signatureStatus: 'signed' };

    await generate();

    // A signed document is a legal artefact — it keeps its own status.
    expect(caseDocumentFixtures.find((d) => d.id === signed.id)?.status).toBe('active');
  });
});
