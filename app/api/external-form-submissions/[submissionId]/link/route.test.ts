import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures } from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

vi.mock('@/lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jotform/jotformClient')>('@/lib/jotform/jotformClient');
  return { ...actual, fetchSubmissionPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 synthetic')) };
});
vi.mock('@/services/documentService', async () => {
  const actual = await vi.importActual<typeof import('@/services/documentService')>('@/services/documentService');
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-manual-link-test' }) };
});
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn().mockResolvedValue({
    authorized: true,
    context: { organizationId: 'managed-cremations', userId: 'staff-1', role: 'administrator' },
  }),
}));

function linkRequest(body: unknown) {
  return new Request('http://localhost/api/external-form-submissions/x/link', {
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

describe('POST /api/external-form-submissions/[submissionId]/link', () => {
  it('links an unmatched submission to an existing case, triggers PDF preservation, never creates a case', async () => {
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    const casesBefore = caseFixtures.length;

    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '262605621454050',
        externalSubmissionId: 'unmatched-sub-1',
        caseFormLinkId: null,
        mappedFields: '{}',
        pdfStatus: 'pending',
      },
      'mock',
    );

    const { VITAL_STATISTICS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { POST } = await import('./route');
    const response = await POST(
      linkRequest({ organizationId: 'managed-cremations', caseId: 'existing-case-1', formConfigId: VITAL_STATISTICS_FORM_CONFIG_ID }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.submission.status).toBe('matched');
    expect(body.pdf.outcome).toBe('stored');
    expect(caseFixtures.length).toBe(casesBefore); // never created a case
  });

  it('rejects linking a submission that is already matched', async () => {
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '262605621454050',
        externalSubmissionId: 'already-matched-sub',
        caseFormLinkId: 'some-link',
        mappedFields: '{}',
        pdfStatus: 'pending',
      },
      'mock',
    );

    const { VITAL_STATISTICS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { POST } = await import('./route');
    const response = await POST(
      linkRequest({ organizationId: 'managed-cremations', caseId: 'existing-case-2', formConfigId: VITAL_STATISTICS_FORM_CONFIG_ID }),
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
        externalFormId: '262605621454050',
        externalSubmissionId: 'other-org-sub',
        caseFormLinkId: null,
        mappedFields: '{}',
        pdfStatus: 'pending',
      },
      'mock',
    );

    const { VITAL_STATISTICS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { POST } = await import('./route');
    const response = await POST(
      linkRequest({ organizationId: 'managed-cremations', caseId: 'existing-case-3', formConfigId: VITAL_STATISTICS_FORM_CONFIG_ID }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );
    expect(response.status).toBe(404);
  });
});
