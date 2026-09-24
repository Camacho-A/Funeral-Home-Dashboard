import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { externalFormSubmissionFixtures } from './__mocks__/externalFormFixtures';

let lengthBefore: number;
beforeEach(() => {
  lengthBefore = externalFormSubmissionFixtures.length;
});
afterEach(() => {
  externalFormSubmissionFixtures.length = lengthBefore;
});

const BASE_PARAMS = {
  organizationId: 'org-1',
  provider: 'jotform',
  externalFormId: '262605621454050',
  externalSubmissionId: 'sub-synthetic-1',
  caseFormLinkId: null,
  mappedFields: '{}',
  pdfStatus: 'pending' as const,
};

describe('receive — idempotency', () => {
  it('a duplicate webhook delivery (same org+provider+externalSubmissionId) never creates a second row', async () => {
    const { receive } = await import('./externalFormSubmissionService');
    const first = await receive(BASE_PARAMS, 'mock');
    const second = await receive(BASE_PARAMS, 'mock');

    expect(first.wasNew).toBe(true);
    expect(second.wasNew).toBe(false);
    expect(first.submission.id).toBe(second.submission.id);

    const matching = externalFormSubmissionFixtures.filter((s) => s.id === first.submission.id);
    expect(matching).toHaveLength(1);
  });

  it('status is "matched" when a caseFormLinkId is supplied, "unmatched" otherwise', async () => {
    const { receive } = await import('./externalFormSubmissionService');
    const unmatched = await receive({ ...BASE_PARAMS, externalSubmissionId: 'sub-unmatched' }, 'mock');
    const matched = await receive({ ...BASE_PARAMS, externalSubmissionId: 'sub-matched', caseFormLinkId: 'link-1' }, 'mock');

    expect(unmatched.submission.status).toBe('unmatched');
    expect(matched.submission.status).toBe('matched');
  });

  it('organization isolation — the deterministic id includes organizationId, so two orgs with the same externalSubmissionId never collide', async () => {
    const { receive } = await import('./externalFormSubmissionService');
    const a = await receive({ ...BASE_PARAMS, organizationId: 'org-a', externalSubmissionId: 'shared-id' }, 'mock');
    const b = await receive({ ...BASE_PARAMS, organizationId: 'org-b', externalSubmissionId: 'shared-id' }, 'mock');
    expect(a.submission.id).not.toBe(b.submission.id);
    expect(a.wasNew).toBe(true);
    expect(b.wasNew).toBe(true);
  });
});

describe('listUnmatched', () => {
  it('only returns unmatched submissions for the requested organization', async () => {
    const { receive, listUnmatched } = await import('./externalFormSubmissionService');
    await receive({ ...BASE_PARAMS, organizationId: 'org-list', externalSubmissionId: 'u1' }, 'mock');
    await receive({ ...BASE_PARAMS, organizationId: 'org-list', externalSubmissionId: 'm1', caseFormLinkId: 'link-x' }, 'mock');
    await receive({ ...BASE_PARAMS, organizationId: 'org-other', externalSubmissionId: 'u2' }, 'mock');

    const results = await listUnmatched('org-list', 'mock');
    expect(results.map((s) => s.externalSubmissionId)).toEqual(['u1']);
  });
});

describe('markLinked / markReviewed / pdf status transitions', () => {
  it('markLinked transitions status to matched and records the resolved caseFormLinkId', async () => {
    const { receive, markLinked } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'sub-link' }, 'mock');
    const updated = await markLinked(submission.id, 'link-99', 'mock');
    expect(updated?.status).toBe('matched');
    expect(updated?.caseFormLinkId).toBe('link-99');
  });

  it('updatePdfStored sets pdfStatus and documentId, clearing any prior failure reason', async () => {
    const { receive, updatePdfFailed, updatePdfStored } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'sub-pdf' }, 'mock');
    await updatePdfFailed(submission.id, 'Jotform PDF retrieval failed (http_error).', 'mock');
    const stored = await updatePdfStored(submission.id, 'document-123', 'mock');
    expect(stored?.pdfStatus).toBe('stored');
    expect(stored?.documentId).toBe('document-123');
    expect(stored?.pdfFailureReason).toBeNull();
  });

  it('updatePdfFailed retains the submission — it is never rolled back or deleted', async () => {
    const { receive, updatePdfFailed, getById } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'sub-fail' }, 'mock');
    await updatePdfFailed(submission.id, 'PDF preservation failed unexpectedly.', 'mock');
    const reloaded = await getById(submission.id, 'mock');
    expect(reloaded).not.toBeNull();
    expect(reloaded?.pdfStatus).toBe('failed');
    expect(reloaded?.status).toBe(submission.status); // submission status itself is untouched by a PDF failure
  });
});
