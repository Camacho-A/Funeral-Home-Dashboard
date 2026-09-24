import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import { externalFormSubmissionFixtures } from './__mocks__/externalFormFixtures';

vi.mock('../lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/jotform/jotformClient')>('../lib/jotform/jotformClient');
  return { ...actual, fetchSubmissionPdf: vi.fn() };
});

vi.mock('./documentService', async () => {
  const actual = await vi.importActual<typeof import('./documentService')>('./documentService');
  return { ...actual, upload: vi.fn() };
});

const CTX = { organizationId: 'org-1', actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1', isSystemGenerated: true };

function makeSubmission(overrides: Partial<ExternalFormSubmission> = {}): ExternalFormSubmission {
  return {
    id: 'sub-1',
    organizationId: 'org-1',
    provider: 'jotform',
    externalFormId: '261945978664175',
    externalSubmissionId: 'ext-sub-1',
    caseFormLinkId: 'link-1',
    status: 'matched',
    mappedFields: '{}',
    receivedAt: '2026-01-01T00:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    documentId: null,
    pdfStatus: 'pending',
    pdfFailureReason: null,
    createdCaseId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let lengthBefore: number;
beforeEach(() => {
  lengthBefore = externalFormSubmissionFixtures.length;
});
afterEach(() => {
  externalFormSubmissionFixtures.length = lengthBefore;
  vi.clearAllMocks();
});

describe('preservePdfForSubmission', () => {
  it('retrieves, validates, and stores the PDF through the existing documentService.upload pipeline', async () => {
    const { fetchSubmissionPdf } = await import('../lib/jotform/jotformClient');
    const { upload } = await import('./documentService');
    vi.mocked(fetchSubmissionPdf).mockResolvedValue(Buffer.from('%PDF-1.4 synthetic'));
    vi.mocked(upload).mockResolvedValue({ id: 'document-1' } as never);

    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);

    const { preservePdfForSubmission } = await import('./externalFormPdfService');
    const result = await preservePdfForSubmission(submission, 'case-1', CTX, 'mock');

    expect(result).toEqual({ outcome: 'stored', documentId: 'document-1' });
    expect(upload).toHaveBeenCalledTimes(1);
    const [uploadParams] = vi.mocked(upload).mock.calls[0];
    expect(uploadParams.fileName).toBe('Arrangement Forms.pdf');
    expect(uploadParams.documentTypeKey).toBe('external_form.arrangement_forms');
    expect(uploadParams.caseId).toBe('case-1');

    const updated = externalFormSubmissionFixtures.find((s) => s.id === submission.id);
    expect(updated?.pdfStatus).toBe('stored');
    expect(updated?.documentId).toBe('document-1');
  });

  it('is idempotent — a submission already pdfStatus "stored" never calls upload again', async () => {
    const { upload } = await import('./documentService');
    const submission = makeSubmission({ pdfStatus: 'stored', documentId: 'already-stored-doc' });
    externalFormSubmissionFixtures.push(submission);

    const { preservePdfForSubmission } = await import('./externalFormPdfService');
    const result = await preservePdfForSubmission(submission, 'case-1', CTX, 'mock');

    expect(result).toEqual({ outcome: 'already_stored', documentId: 'already-stored-doc' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('a failed PDF retrieval records a sanitized failure reason and never leaves the submission in a lost state', async () => {
    const { fetchSubmissionPdf, JotformClientError } = await import('../lib/jotform/jotformClient');
    vi.mocked(fetchSubmissionPdf).mockRejectedValue(new JotformClientError('raw provider detail that should never surface', 'http_error'));

    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);

    const { preservePdfForSubmission } = await import('./externalFormPdfService');
    const result = await preservePdfForSubmission(submission, 'case-1', CTX, 'mock');

    expect(result.outcome).toBe('failed');
    const updated = externalFormSubmissionFixtures.find((s) => s.id === submission.id);
    expect(updated?.pdfStatus).toBe('failed');
    expect(updated?.pdfFailureReason).toBe('Jotform PDF retrieval failed (http_error).');
    expect(updated?.pdfFailureReason).not.toContain('raw provider detail');
    // The submission itself is retained, never rolled back.
    expect(externalFormSubmissionFixtures.some((s) => s.id === submission.id)).toBe(true);
  });

  it('a retry after a failure succeeds and does not duplicate the document', async () => {
    const { fetchSubmissionPdf } = await import('../lib/jotform/jotformClient');
    const { upload } = await import('./documentService');
    vi.mocked(fetchSubmissionPdf).mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(Buffer.from('%PDF-1.4 synthetic'));
    vi.mocked(upload).mockResolvedValue({ id: 'document-retry' } as never);

    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);

    const { preservePdfForSubmission } = await import('./externalFormPdfService');
    const firstAttempt = await preservePdfForSubmission(submission, 'case-1', CTX, 'mock');
    expect(firstAttempt.outcome).toBe('failed');

    const reloaded = externalFormSubmissionFixtures.find((s) => s.id === submission.id)!;
    const secondAttempt = await preservePdfForSubmission(reloaded, 'case-1', CTX, 'mock');
    expect(secondAttempt).toEqual({ outcome: 'stored', documentId: 'document-retry' });
    expect(upload).toHaveBeenCalledTimes(1); // only the successful attempt actually uploaded
  });

  it('picks the correct document type/filename for Vital Statistics vs Arrangement Forms', async () => {
    const { fetchSubmissionPdf } = await import('../lib/jotform/jotformClient');
    const { upload } = await import('./documentService');
    vi.mocked(fetchSubmissionPdf).mockResolvedValue(Buffer.from('%PDF-1.4 synthetic'));
    vi.mocked(upload).mockResolvedValue({ id: 'doc-vs' } as never);

    const submission = makeSubmission({ externalFormId: '262605621454050' });
    externalFormSubmissionFixtures.push(submission);

    const { preservePdfForSubmission } = await import('./externalFormPdfService');
    await preservePdfForSubmission(submission, 'case-1', CTX, 'mock');

    const [uploadParams] = vi.mocked(upload).mock.calls[0];
    expect(uploadParams.fileName).toBe('Vital Statistics Information Sheet.pdf');
    expect(uploadParams.documentTypeKey).toBe('external_form.vital_statistics');
  });
});
