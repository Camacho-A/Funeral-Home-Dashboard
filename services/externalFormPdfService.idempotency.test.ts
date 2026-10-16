import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import type { CaseDocument } from '../types/caseDocument';
import { externalFormSubmissionFixtures } from './__mocks__/externalFormFixtures';
import { caseDocumentFixtures } from './__mocks__/documentFixtures';
import { WixDataApiError } from '../lib/wixDataApi';

/**
 * PDF import idempotency and partial-failure recovery (2026-10).
 *
 * Duplicate prevention used to rest entirely on the SUBMISSION's
 * `pdfStatus`/`documentId`, written after the document already existed.
 * Losing that write, or two callers racing past the check, stored a second
 * copy of the same form on the case. The document id is now derived from
 * the submission, so an existing copy is found and adopted instead.
 */

vi.mock('../lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/jotform/jotformClient')>('../lib/jotform/jotformClient');
  return { ...actual, fetchSubmissionPdf: vi.fn() };
});

vi.mock('./documentService', async () => {
  const actual = await vi.importActual<typeof import('./documentService')>('./documentService');
  return { ...actual, upload: vi.fn() };
});

vi.mock('./externalFormSubmissionService', async () => {
  const actual = await vi.importActual<typeof import('./externalFormSubmissionService')>('./externalFormSubmissionService');
  return { ...actual, updatePdfStored: vi.fn(actual.updatePdfStored) };
});

const ORG = 'managed-cremations';
const CASE_ID = 'case-idem';
const CTX = { organizationId: ORG, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1', isSystemGenerated: true };

function makeSubmission(overrides: Partial<ExternalFormSubmission> = {}): ExternalFormSubmission {
  return {
    id: `${ORG}-jotform-ext-idem`,
    organizationId: ORG,
    provider: 'jotform',
    externalFormId: '261945978664175',
    externalSubmissionId: 'ext-idem',
    caseFormLinkId: 'link-1',
    status: 'matched',
    mappedFields: '{}',
    receivedAt: '2026-10-01T00:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    documentId: null,
    pdfStatus: 'pending',
    pdfFailureReason: null,
    createdCaseId: null,
    caseCreationFailureReason: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function storedDocument(id: string, overrides: Partial<CaseDocument> = {}): CaseDocument {
  return {
    id,
    organizationId: ORG,
    caseId: CASE_ID,
    origin: 'uploaded',
    documentTypeKey: 'external_form.arrangement_forms',
    category: null,
    fileName: 'Arrangement Forms.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 100,
    checksumSha256: 'abc',
    storageKey: `${ORG}/${CASE_ID}/${id}-Arrangement_Forms.pdf`,
    status: 'active',
    templateId: null,
    templateVersion: null,
    version: null,
    supersedesId: null,
    signatureStatus: null,
    familyVisible: false,
    generatedBy: null,
    uploadedBy: null,
    createdAt: new Date().toISOString(),
    correlationId: 'corr-0',
    ...overrides,
  };
}

let submissionsBefore: number;
let documentsBefore: number;
beforeEach(async () => {
  submissionsBefore = externalFormSubmissionFixtures.length;
  documentsBefore = caseDocumentFixtures.length;
  const { fetchSubmissionPdf } = await import('../lib/jotform/jotformClient');
  vi.mocked(fetchSubmissionPdf).mockResolvedValue(Buffer.from('%PDF-1.4 synthetic'));
  const { upload } = await import('./documentService');
  // Mirrors the real upload: the document row exists under the id the
  // caller supplied.
  vi.mocked(upload).mockImplementation(async (params) => {
    const doc = storedDocument(params.idFactory(), { fileName: params.fileName, documentTypeKey: params.documentTypeKey ?? null });
    caseDocumentFixtures.push(doc);
    return doc;
  });
});
afterEach(() => {
  externalFormSubmissionFixtures.length = submissionsBefore;
  caseDocumentFixtures.length = documentsBefore;
  vi.clearAllMocks();
});

async function load() {
  return import('./externalFormPdfService');
}

describe('submissionPdfDocumentId', () => {
  it('is deterministic, distinct per submission, and well under the Wix 128-char _id cap', async () => {
    const { submissionPdfDocumentId } = await load();
    const longId = `${'x'.repeat(200)}`;
    expect(submissionPdfDocumentId('a')).toBe(submissionPdfDocumentId('a'));
    expect(submissionPdfDocumentId('a')).not.toBe(submissionPdfDocumentId('b'));
    expect(submissionPdfDocumentId(longId).length).toBeLessThan(128);
  });
});

describe('preservePdfForSubmission — duplicate prevention', () => {
  it('stores the PDF under the deterministic id for the submission', async () => {
    const { preservePdfForSubmission, submissionPdfDocumentId } = await load();
    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);

    const result = await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');

    expect(result).toEqual({ outcome: 'stored', documentId: submissionPdfDocumentId(submission.id) });
  });

  it('when the submission could not be marked stored, the PDF is NOT reported as failed, and a retry adopts it instead of uploading again', async () => {
    const { preservePdfForSubmission } = await load();
    const { upload } = await import('./documentService');
    const submissionService = await import('./externalFormSubmissionService');
    vi.mocked(submissionService.updatePdfStored).mockRejectedValueOnce(new Error('Wix write failed'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);

    const first = await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');
    expect(first.outcome).toBe('stored');
    const afterFirst = externalFormSubmissionFixtures.find((s) => s.id === submission.id)!;
    expect(afterFirst.pdfStatus).not.toBe('failed');
    expect(errors).toHaveBeenCalled();

    // Redelivery / "Retry PDF": the submission still looks unstored.
    const second = await preservePdfForSubmission(afterFirst, CASE_ID, CTX, 'mock');
    expect(second).toEqual({ outcome: 'already_stored', documentId: first.documentId });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(caseDocumentFixtures.filter((d) => d.caseId === CASE_ID)).toHaveLength(1);

    const repaired = externalFormSubmissionFixtures.find((s) => s.id === submission.id)!;
    expect(repaired.pdfStatus).toBe('stored');
    expect(repaired.documentId).toBe(first.documentId);
    errors.mockRestore();
  });

  it('a concurrent caller still uploading → in_progress, no second upload, nothing marked failed', async () => {
    const { preservePdfForSubmission, submissionPdfDocumentId } = await load();
    const { upload } = await import('./documentService');
    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);
    caseDocumentFixtures.push(storedDocument(submissionPdfDocumentId(submission.id), { status: 'pending' }));

    const result = await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');

    expect(result).toEqual({ outcome: 'in_progress', documentId: null });
    expect(upload).not.toHaveBeenCalled();
    expect(externalFormSubmissionFixtures.find((s) => s.id === submission.id)!.pdfStatus).toBe('pending');
  });

  it('losing the insert race (duplicate id, HTTP 409) → in_progress, not a failure', async () => {
    const { preservePdfForSubmission } = await load();
    const { upload } = await import('./documentService');
    vi.mocked(upload).mockRejectedValueOnce(new WixDataApiError('Wix Data insert failed for collection "caseDocuments" (HTTP 409).', 409));
    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);

    const result = await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');

    expect(result).toEqual({ outcome: 'in_progress', documentId: null });
    expect(externalFormSubmissionFixtures.find((s) => s.id === submission.id)!.pdfStatus).toBe('pending');
  });

  it('an abandoned pending attempt does not block forever — a new attempt is stored under a fresh id', async () => {
    const { preservePdfForSubmission, submissionPdfDocumentId } = await load();
    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);
    const baseId = submissionPdfDocumentId(submission.id);
    caseDocumentFixtures.push(storedDocument(baseId, { status: 'pending', createdAt: '2026-10-01T00:00:00.000Z' }));

    const result = await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');

    expect(result).toEqual({ outcome: 'stored', documentId: `${baseId}-2` });
  });

  it('a failed storage attempt is detected, logged and recorded; the retry stores one copy under a fresh id', async () => {
    const { preservePdfForSubmission, submissionPdfDocumentId } = await load();
    const { upload } = await import('./documentService');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);
    const baseId = submissionPdfDocumentId(submission.id);

    // Real upload behaviour on a storage error: the row is left 'failed'.
    vi.mocked(upload).mockImplementationOnce(async (params) => {
      caseDocumentFixtures.push(storedDocument(params.idFactory(), { status: 'failed' }));
      throw new Error('Blob storage unavailable');
    });

    const first = await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');
    expect(first.outcome).toBe('failed');
    const failed = externalFormSubmissionFixtures.find((s) => s.id === submission.id)!;
    expect(failed.pdfStatus).toBe('failed');
    expect(failed.pdfFailureReason).toBe('PDF preservation failed unexpectedly.');
    expect(errors.mock.calls.some((call) => String(call[1]).includes('Blob storage unavailable'))).toBe(true);

    const second = await preservePdfForSubmission(failed, CASE_ID, CTX, 'mock');
    expect(second).toEqual({ outcome: 'stored', documentId: `${baseId}-2` });
    expect(caseDocumentFixtures.filter((d) => d.caseId === CASE_ID && d.status === 'active')).toHaveLength(1);
    errors.mockRestore();
  });

  it('an inaccessible / expired Jotform PDF is recorded as a failed retrieval, nothing stored', async () => {
    const { preservePdfForSubmission } = await load();
    const { fetchSubmissionPdf, JotformClientError } = await import('../lib/jotform/jotformClient');
    const { upload } = await import('./documentService');
    vi.mocked(fetchSubmissionPdf).mockRejectedValueOnce(new JotformClientError('404 from provider', 'http_error'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);

    const result = await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');

    expect(result.outcome).toBe('failed');
    expect(upload).not.toHaveBeenCalled();
    expect(externalFormSubmissionFixtures.find((s) => s.id === submission.id)!.pdfFailureReason).toBe('Jotform PDF retrieval failed (http_error).');
    errors.mockRestore();
  });

  it('never adopts a document belonging to a different submission on the same case', async () => {
    const { preservePdfForSubmission, submissionPdfDocumentId } = await load();
    const other = makeSubmission({ id: `${ORG}-jotform-ext-other`, externalSubmissionId: 'ext-other' });
    caseDocumentFixtures.push(storedDocument(submissionPdfDocumentId(other.id)));
    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);

    const result = await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');

    expect(result).toEqual({ outcome: 'stored', documentId: submissionPdfDocumentId(submission.id) });
  });

  it('never adopts a same-id document stored under another organization', async () => {
    const { preservePdfForSubmission, submissionPdfDocumentId } = await load();
    const { upload } = await import('./documentService');
    const submission = makeSubmission();
    externalFormSubmissionFixtures.push(submission);
    caseDocumentFixtures.push(storedDocument(submissionPdfDocumentId(submission.id), { organizationId: 'gus-camacho-jr' }));

    await preservePdfForSubmission(submission, CASE_ID, CTX, 'mock');

    expect(upload).toHaveBeenCalledTimes(1);
  });
});
