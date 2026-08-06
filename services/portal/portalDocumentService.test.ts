import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockDownloadFile = vi.fn();

vi.mock('../../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: vi.fn(),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
    deleteFile: vi.fn(),
  },
}));

const { caseDocumentFixtures } = await import('../__mocks__/documentFixtures');
const { activityEventFixtures } = await import('../__mocks__/activityEventFixtures');
import type { CaseDocument } from '../../types/caseDocument';

function makeDocument(overrides: Partial<CaseDocument> = {}): CaseDocument {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    caseId: 'case-1',
    origin: 'generated',
    documentTypeKey: 'authorization.cremation',
    category: 'authorization',
    fileName: 'Cremation Authorization.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 100,
    checksumSha256: 'a'.repeat(64),
    storageKey: 'org-1/case-1/doc-1.pdf',
    status: 'active',
    templateId: 'template-1',
    templateVersion: 1,
    version: 1,
    supersedesId: null,
    signatureStatus: null,
    familyVisible: false,
    generatedBy: 'identity-1',
    uploadedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
}

let lengths: { docs: number; events: number };
beforeEach(() => {
  vi.clearAllMocks();
  mockDownloadFile.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' });
  lengths = { docs: caseDocumentFixtures.length, events: activityEventFixtures.length };
});
afterEach(() => {
  caseDocumentFixtures.length = lengths.docs;
  activityEventFixtures.length = lengths.events;
});

describe('portalDocumentService', () => {
  describe('listFamilyVisibleDocuments', () => {
    it('only returns documents that are both familyVisible and active', async () => {
      const { listFamilyVisibleDocuments } = await import('./portalDocumentService');
      caseDocumentFixtures.push(
        makeDocument({ id: 'doc-visible-active', familyVisible: true, status: 'active' }),
        makeDocument({ id: 'doc-not-visible', familyVisible: false, status: 'active' }),
        makeDocument({ id: 'doc-visible-archived', familyVisible: true, status: 'archived' }),
        makeDocument({ id: 'doc-visible-pending', familyVisible: true, status: 'pending' }),
      );

      const list = await listFamilyVisibleDocuments('org-1', 'case-1', 'mock');
      expect(list.map((d) => d.id)).toEqual(['doc-visible-active']);
    });

    it('never returns a raw CaseDocument field like storageKey', async () => {
      const { listFamilyVisibleDocuments } = await import('./portalDocumentService');
      caseDocumentFixtures.push(makeDocument({ id: 'doc-x', familyVisible: true, status: 'active' }));

      const list = await listFamilyVisibleDocuments('org-1', 'case-1', 'mock');
      expect(Object.keys(list[0])).not.toContain('storageKey');
    });
  });

  describe('downloadFamilyDocument', () => {
    it('downloads a familyVisible, active document and records portal.document.viewed with the real portalUserId', async () => {
      const { downloadFamilyDocument } = await import('./portalDocumentService');
      caseDocumentFixtures.push(makeDocument({ id: 'doc-download', familyVisible: true, status: 'active' }));

      const result = await downloadFamilyDocument('org-1', 'case-1', 'doc-download', 'portal-user-1', 'mock');
      expect(result.buffer.toString()).toContain('PDF');

      const recorded = activityEventFixtures.at(-1);
      expect(recorded?.eventType).toBe('portal.document.viewed');
      expect(recorded?.actorIdentityId).toBeNull();
      expect(JSON.parse(recorded!.metadata!)).toEqual({ portalUserId: 'portal-user-1' });
    });

    it('refuses to download a document that is not familyVisible, without distinguishing from "not found"', async () => {
      const { downloadFamilyDocument, PortalDocumentServiceError } = await import('./portalDocumentService');
      caseDocumentFixtures.push(makeDocument({ id: 'doc-hidden', familyVisible: false, status: 'active' }));

      await expect(downloadFamilyDocument('org-1', 'case-1', 'doc-hidden', 'portal-user-1', 'mock')).rejects.toThrow(PortalDocumentServiceError);
    });

    it('refuses to download a familyVisible document that is not active (e.g. archived)', async () => {
      const { downloadFamilyDocument, PortalDocumentServiceError } = await import('./portalDocumentService');
      caseDocumentFixtures.push(makeDocument({ id: 'doc-archived', familyVisible: true, status: 'archived' }));

      await expect(downloadFamilyDocument('org-1', 'case-1', 'doc-archived', 'portal-user-1', 'mock')).rejects.toThrow(PortalDocumentServiceError);
    });

    it('refuses to download a document belonging to a different case', async () => {
      const { downloadFamilyDocument, PortalDocumentServiceError } = await import('./portalDocumentService');
      caseDocumentFixtures.push(makeDocument({ id: 'doc-other-case', caseId: 'case-other', familyVisible: true, status: 'active' }));

      await expect(downloadFamilyDocument('org-1', 'case-1', 'doc-other-case', 'portal-user-1', 'mock')).rejects.toThrow(PortalDocumentServiceError);
    });
  });
});
