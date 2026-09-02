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
