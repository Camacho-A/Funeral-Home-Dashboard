import { describe, expect, it, vi } from 'vitest';
import type { CaseDocument } from '@/types/caseDocument';

/**
 * A case's documents are read in full (2026-10): an unpaginated Wix query
 * stops at 50 rows, and a case past 50 documents would silently lose the
 * rest — its State Cremation Permit among them. Fictional rows only.
 */
vi.mock('../lib/wixDataApi', async () => {
  const actual = await vi.importActual<typeof import('../lib/wixDataApi')>('../lib/wixDataApi');
  return { ...actual, queryAllWixDataItems: vi.fn(), queryWixDataItems: vi.fn() };
});
const wix = await import('../lib/wixDataApi');
const { list } = await import('./documentService');
const { buildWixCaseDocumentData } = await import('../lib/wixCaseDocumentMapper');

const doc = (n: number, over: Partial<CaseDocument> = {}): CaseDocument => ({
  id: `doc-${n}`,
  organizationId: 'managed-cremations',
  caseId: 'case-1',
  origin: 'generated',
  documentTypeKey: 'financial.statement_goods_services',
  category: 'statement',
  fileName: `Statement ${n}.pdf`,
  mimeType: 'application/pdf',
  fileSizeBytes: 100,
  checksumSha256: `sha-${n}`,
  storageKey: `managed-cremations/case-1/doc-${n}.pdf`,
  status: 'superseded',
  templateId: null,
  templateVersion: null,
  version: n,
  supersedesId: null,
  signatureStatus: null,
  familyVisible: false,
  generatedBy: 'staff',
  uploadedBy: null,
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
  correlationId: 'corr-1',
  ...over,
});

describe('documentService.list — every document of the case', () => {
  it('returns all rows past the first 50 — the permit uploaded last included — for that organization and case only, newest first', async () => {
    const rows = Array.from({ length: 119 }, (_, i) => doc(i));
    rows.push(doc(200, { origin: 'uploaded', documentTypeKey: 'cremation_form.state_permit', category: null, fileName: 'FICTIONAL PERMIT.pdf', status: 'active', version: 1 }));
    vi.mocked(wix.queryAllWixDataItems).mockResolvedValue(rows.map((d) => ({ id: d.id, dataCollectionId: 'caseDocuments', data: buildWixCaseDocumentData(d) })) as never);

    const result = await list('managed-cremations', 'case-1', 'wix');
    expect(result).toHaveLength(120);
    expect(result[0]).toMatchObject({ id: 'doc-200', fileName: 'FICTIONAL PERMIT.pdf', documentTypeKey: 'cremation_form.state_permit' });
    expect(wix.queryAllWixDataItems).toHaveBeenCalledWith('caseDocuments', { organizationId: 'managed-cremations', caseId: 'case-1' });
    expect(wix.queryWixDataItems).not.toHaveBeenCalled();
  });
});
