import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures, ARRANGEMENT_FORMS_FORM_CONFIG_ID } from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

/**
 * Manors Jotform integration — PDF repair (2026-09), checkpoint's TESTS —
 * JOTFORM DOCUMENTS item 37: "Safe PDF retry succeeds without re-importing
 * Case." Mirrors the sibling `link`/`import-submission` routes' own test
 * shape exactly (mock-mode, requireAuthorizedOrganization mocked directly).
 */

vi.mock('@/lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jotform/jotformClient')>('@/lib/jotform/jotformClient');
  return { ...actual, fetchSubmissionPdf: vi.fn() };
});
vi.mock('@/services/documentService', async () => {
  const actual = await vi.importActual<typeof import('@/services/documentService')>('@/services/documentService');
  return { ...actual, upload: vi.fn() };
});
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn().mockResolvedValue({
    authorized: true,
    context: { organizationId: 'managed-cremations', userId: 'staff-1', role: 'administrator' },
  }),
}));

function retryRequest(body: unknown) {
  return new Request('http://localhost/api/external-form-submissions/x/retry-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

let caseFormLinkLengthBefore: number;
let submissionLengthBefore: number;
let activityLengthBefore: number;
beforeEach(() => {
  caseFormLinkLengthBefore = caseFormLinkFixtures.length;
  submissionLengthBefore = externalFormSubmissionFixtures.length;
  activityLengthBefore = activityEventFixtures.length;
});
afterEach(() => {
  caseFormLinkFixtures.length = caseFormLinkLengthBefore;
  externalFormSubmissionFixtures.length = submissionLengthBefore;
  activityEventFixtures.length = activityLengthBefore;
  vi.clearAllMocks();
});

async function seedLinkedFailedSubmission(caseId: string, externalSubmissionId: string) {
  const caseFormLinkService = await import('@/services/caseFormLinkService');
  const { receive, updatePdfFailed } = await import('@/services/externalFormSubmissionService');

  const link = await caseFormLinkService.linkExistingSubmission(
    'managed-cremations',
    caseId,
    'jotform',
    ARRANGEMENT_FORMS_FORM_CONFIG_ID,
    `dummy-${externalSubmissionId}`,
    'mock',
  );

  const { submission } = await receive(
    {
      organizationId: 'managed-cremations',
      provider: 'jotform',
      externalFormId: '261945978664175',
      externalSubmissionId,
      caseFormLinkId: link.id,
      mappedFields: '{}',
      pdfStatus: 'pending',
    },
    'mock',
  );
  await updatePdfFailed(submission.id, 'Jotform PDF retrieval failed (http_error).', 'mock');
  return { link, submission };
}

describe('POST /api/external-form-submissions/[submissionId]/retry-pdf', () => {
  it('37: retries and succeeds for an already-linked submission whose PDF previously failed — no re-import, no new case', async () => {
    const { fetchSubmissionPdf } = await import('@/lib/jotform/jotformClient');
    const { upload } = await import('@/services/documentService');
    vi.mocked(fetchSubmissionPdf).mockResolvedValue(Buffer.from('%PDF-1.4 synthetic'));
    vi.mocked(upload).mockResolvedValue({ id: 'document-retry-route-test' } as never);

    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    const casesBefore = caseFixtures.length;
    const { submission } = await seedLinkedFailedSubmission('existing-case-retry-1', 'retry-sub-1');

    const { POST } = await import('./route');
    const response = await POST(
      retryRequest({ organizationId: 'managed-cremations' }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pdf.outcome).toBe('stored');
    expect(body.caseId).toBe('existing-case-retry-1');
    expect(caseFixtures.length).toBe(casesBefore); // never created/re-imported a case
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — retrying an already-stored submission is a safe no-op, never a duplicate document', async () => {
    const { upload } = await import('@/services/documentService');
    const { link, submission } = await seedLinkedFailedSubmission('existing-case-retry-2', 'retry-sub-2');
    const { updatePdfStored } = await import('@/services/externalFormSubmissionService');
    await updatePdfStored(submission.id, 'already-stored-doc-id', 'mock');
    void link;

    const { POST } = await import('./route');
    const response = await POST(
      retryRequest({ organizationId: 'managed-cremations' }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pdf).toEqual({ outcome: 'already_stored', documentId: 'already-stored-doc-id' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns 409 for a submission that was never linked to any case — nothing to retry against', async () => {
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '261945978664175',
        externalSubmissionId: 'never-linked-sub',
        caseFormLinkId: null,
        mappedFields: '{}',
        pdfStatus: 'pending',
      },
      'mock',
    );

    const { POST } = await import('./route');
    const response = await POST(
      retryRequest({ organizationId: 'managed-cremations' }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );
    expect(response.status).toBe(409);
  });

  it('returns 404 for a submission belonging to a different organization', async () => {
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'a-totally-different-org',
        provider: 'jotform',
        externalFormId: '261945978664175',
        externalSubmissionId: 'other-org-retry-sub',
        caseFormLinkId: null,
        mappedFields: '{}',
        pdfStatus: 'pending',
      },
      'mock',
    );

    const { POST } = await import('./route');
    const response = await POST(
      retryRequest({ organizationId: 'managed-cremations' }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 for a nonexistent submission id', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      retryRequest({ organizationId: 'managed-cremations' }),
      { params: Promise.resolve({ submissionId: 'no-such-submission' }) },
    );
    expect(response.status).toBe(404);
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost/api/external-form-submissions/x/retry-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com', Host: 'localhost' },
        body: JSON.stringify({ organizationId: 'managed-cremations' }),
      }),
      { params: Promise.resolve({ submissionId: 'whatever' }) },
    );
    expect(response.status).toBe(403);
  });
});

/**
 * Half-linked recovery (2026-10). An Arrangement-first case used to get a
 * CaseFormLink pointing at its submission while the submission never
 * pointed back — `caseFormLinkId` null, `status` 'matched'. Neither
 * recovery route could touch that state: this one refused the missing
 * back-reference, and the manual link route refuses anything already
 * matched. B2026-038 sat exactly there with its PDF unreachable.
 */
describe('POST retry-pdf — recovers a submission whose back-reference was never written', () => {
  it('finds the link by submission and imports the PDF', async () => {
    const { fetchSubmissionPdf } = await import('@/lib/jotform/jotformClient');
    const { upload } = await import('@/services/documentService');
    vi.mocked(fetchSubmissionPdf).mockResolvedValue(Buffer.from('%PDF-1.4 synthetic'));
    vi.mocked(upload).mockResolvedValue({ id: 'document-halflinked-test' } as never);

    const { submission } = await seedLinkedFailedSubmission('existing-case-halflinked', 'retry-sub-halflinked');
    // Exactly B2026-038's shape: the link points at the submission, the
    // submission does not point back, and status is already 'matched'.
    const caseFormLinkService = await import('@/services/caseFormLinkService');
    const seededLink = caseFormLinkFixtures.find((l) => l.caseId === 'existing-case-halflinked')!;
    await caseFormLinkService.markReceived(seededLink.id, submission.id, 'mock');
    const index = externalFormSubmissionFixtures.findIndex((s) => s.id === submission.id);
    externalFormSubmissionFixtures[index] = {
      ...externalFormSubmissionFixtures[index],
      caseFormLinkId: null,
      status: 'matched',
      pdfStatus: 'pending',
      documentId: null,
    };

    const { POST } = await import('./route');
    const response = await POST(
      retryRequest({ organizationId: 'managed-cremations' }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pdf.outcome).toBe('stored');
    expect(body.caseId).toBe('existing-case-halflinked');

    // The pointer is repaired, so the row is no longer stuck.
    const after = externalFormSubmissionFixtures.find((s) => s.id === submission.id)!;
    expect(after.caseFormLinkId).toBeTruthy();
  });

  it('still refuses a submission that genuinely has no link', async () => {
    const { submission } = await seedLinkedFailedSubmission('existing-case-nolink', 'retry-sub-nolink');
    const index = externalFormSubmissionFixtures.findIndex((s) => s.id === submission.id);
    externalFormSubmissionFixtures[index] = { ...externalFormSubmissionFixtures[index], caseFormLinkId: null };
    caseFormLinkFixtures.length = 0;

    const { POST } = await import('./route');
    const response = await POST(
      retryRequest({ organizationId: 'managed-cremations' }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(409);
  });
});
