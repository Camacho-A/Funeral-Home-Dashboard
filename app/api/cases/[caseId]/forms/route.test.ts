import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures, ARRANGEMENT_FORMS_FORM_CONFIG_ID, VITAL_STATISTICS_FORM_CONFIG_ID } from '@/services/__mocks__/externalFormFixtures';

/**
 * Case repair UI (2026-09) — this route's own extension: exposing
 * `pdfStatus`/`documentId` per form row (read-only) so the UI can derive
 * Retry Jotform PDF visibility without a second round trip or requiring a
 * user-entered submission id. Pre-existing "one row per config" behavior
 * is unchanged and not re-tested here in full.
 */

vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn().mockResolvedValue({
    authorized: true,
    context: { organizationId: 'managed-cremations', userId: 'staff-1', role: 'administrator' },
  }),
}));

function formsRequest(caseId: string) {
  return new Request(`http://localhost/api/cases/${caseId}/forms?organizationId=managed-cremations`);
}

let caseFormLinkLengthBefore: number;
let submissionLengthBefore: number;
beforeEach(() => {
  caseFormLinkLengthBefore = caseFormLinkFixtures.length;
  submissionLengthBefore = externalFormSubmissionFixtures.length;
});
afterEach(() => {
  caseFormLinkFixtures.length = caseFormLinkLengthBefore;
  externalFormSubmissionFixtures.length = submissionLengthBefore;
  vi.clearAllMocks();
});

describe('GET /api/cases/[caseId]/forms — pdfStatus/documentId exposure (case repair UI, 2026-09)', () => {
  it('reports pdfStatus: null / documentId: null for a config with no submission linked yet', async () => {
    const { GET } = await import('./route');
    const response = await GET(formsRequest('case-forms-test-1'), { params: Promise.resolve({ caseId: 'case-forms-test-1' }) });
    const body = await response.json();
    const vitalRow = body.forms.find((r: { config: { id: string } }) => r.config.id === VITAL_STATISTICS_FORM_CONFIG_ID);
    expect(vitalRow.submissionId).toBeNull();
    expect(vitalRow.pdfStatus).toBeNull();
    expect(vitalRow.documentId).toBeNull();
  });

  it('reports the real pdfStatus/documentId for a linked submission whose PDF failed', async () => {
    const caseFormLinkService = await import('@/services/caseFormLinkService');
    const { receive, updatePdfFailed } = await import('@/services/externalFormSubmissionService');

    const { link } = await caseFormLinkService.generateLinkForSending('managed-cremations', 'case-forms-test-2', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '261945978664175',
        externalSubmissionId: 'forms-test-sub-2',
        caseFormLinkId: link.id,
        mappedFields: '{}',
        pdfStatus: 'pending',
      },
      'mock',
    );
    await caseFormLinkService.markReceived(link.id, submission.id, 'mock');
    await updatePdfFailed(submission.id, 'Jotform PDF retrieval failed (http_error).', 'mock');

    const { GET } = await import('./route');
    const response = await GET(formsRequest('case-forms-test-2'), { params: Promise.resolve({ caseId: 'case-forms-test-2' }) });
    const body = await response.json();
    const row = body.forms.find((r: { config: { id: string } }) => r.config.id === ARRANGEMENT_FORMS_FORM_CONFIG_ID);
    expect(row.submissionId).toBe(submission.id);
    expect(row.pdfStatus).toBe('failed');
    expect(row.documentId).toBeNull();
  });

  it('reports pdfStatus "stored" with a documentId once successfully preserved', async () => {
    const caseFormLinkService = await import('@/services/caseFormLinkService');
    const { receive, updatePdfStored } = await import('@/services/externalFormSubmissionService');

    const { link } = await caseFormLinkService.generateLinkForSending('managed-cremations', 'case-forms-test-3', 'jotform', VITAL_STATISTICS_FORM_CONFIG_ID, 'mock');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '262605621454050',
        externalSubmissionId: 'forms-test-sub-3',
        caseFormLinkId: link.id,
        mappedFields: '{}',
        pdfStatus: 'pending',
      },
      'mock',
    );
    await caseFormLinkService.markReceived(link.id, submission.id, 'mock');
    await updatePdfStored(submission.id, 'doc-forms-test-3', 'mock');

    const { GET } = await import('./route');
    const response = await GET(formsRequest('case-forms-test-3'), { params: Promise.resolve({ caseId: 'case-forms-test-3' }) });
    const body = await response.json();
    const row = body.forms.find((r: { config: { id: string } }) => r.config.id === VITAL_STATISTICS_FORM_CONFIG_ID);
    expect(row.pdfStatus).toBe('stored');
    expect(row.documentId).toBe('doc-forms-test-3');
  });

  it('this GET route never mutates anything — no insert/update side effects', async () => {
    const insertSpy = vi.spyOn(await import('@/lib/wixDataApi'), 'insertWixDataItem');
    const { GET } = await import('./route');
    await GET(formsRequest('case-forms-test-4'), { params: Promise.resolve({ caseId: 'case-forms-test-4' }) });
    expect(insertSpy).not.toHaveBeenCalled();
    insertSpy.mockRestore();
  });
});
