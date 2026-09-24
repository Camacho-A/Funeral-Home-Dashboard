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

describe('claimForCaseCreation / revertCaseCreationClaim / markCaseCreated — historical case creation (2026-09)', () => {
  it('claims a fresh (createdCaseId: null) submission and returns a unique claim token', async () => {
    const { receive, claimForCaseCreation } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'claim-1' }, 'mock');
    const result = await claimForCaseCreation(submission.id, 'mock');
    expect(result.claimed).toBe(true);
    if (result.claimed) {
      expect(result.claimToken).toMatch(/^CLAIMING:/);
    }
  });

  it('a second claim attempt on an already-claimed submission never succeeds, and reports stillClaiming', async () => {
    const { receive, claimForCaseCreation } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'claim-2' }, 'mock');
    const first = await claimForCaseCreation(submission.id, 'mock');
    expect(first.claimed).toBe(true);

    const second = await claimForCaseCreation(submission.id, 'mock');
    expect(second.claimed).toBe(false);
    if (!second.claimed) {
      expect(second.stillClaiming).toBe(true);
      expect(second.existingCaseId).toBeNull();
    }
  });

  it('concurrent claim attempts on the SAME submission: exactly one wins, never both', async () => {
    const { receive, claimForCaseCreation } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'claim-concurrent' }, 'mock');

    const [a, b] = await Promise.all([claimForCaseCreation(submission.id, 'mock'), claimForCaseCreation(submission.id, 'mock')]);
    const claimedCount = [a, b].filter((r) => r.claimed).length;
    expect(claimedCount).toBe(1);
  });

  it('a claim attempt on a submission that already has a real case id reports the existing case id, never re-claims', async () => {
    const { receive, markCaseCreated, claimForCaseCreation } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'claim-existing-case' }, 'mock');
    await markCaseCreated(submission.id, 'real-case-id-1', 'mock');

    const result = await claimForCaseCreation(submission.id, 'mock');
    expect(result.claimed).toBe(false);
    if (!result.claimed) {
      expect(result.existingCaseId).toBe('real-case-id-1');
      expect(result.stillClaiming).toBe(false);
    }
  });

  it('revertCaseCreationClaim clears a claim only if the token still matches, enabling a clean retry', async () => {
    const { receive, claimForCaseCreation, revertCaseCreationClaim, getById } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'claim-revert' }, 'mock');
    const claim = await claimForCaseCreation(submission.id, 'mock');
    expect(claim.claimed).toBe(true);
    if (!claim.claimed) return;

    await revertCaseCreationClaim(submission.id, claim.claimToken, 'mock');
    const reloaded = await getById(submission.id, 'mock');
    expect(reloaded?.createdCaseId).toBeNull();

    // A retry can now claim cleanly.
    const retryClaim = await claimForCaseCreation(submission.id, 'mock');
    expect(retryClaim.claimed).toBe(true);
  });

  it('revertCaseCreationClaim never clobbers a DIFFERENT (concurrently-set) claim token', async () => {
    const { receive, claimForCaseCreation, revertCaseCreationClaim, getById } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'claim-revert-defensive' }, 'mock');
    await claimForCaseCreation(submission.id, 'mock');

    // A stale/wrong token must never clear someone else's real claim.
    await revertCaseCreationClaim(submission.id, 'CLAIMING:not-the-real-token', 'mock');
    const reloaded = await getById(submission.id, 'mock');
    expect(reloaded?.createdCaseId).not.toBeNull();
  });

  it('markCaseCreated persists a real case id, distinguishable from a claim token', async () => {
    const { receive, markCaseCreated } = await import('./externalFormSubmissionService');
    const { submission } = await receive({ ...BASE_PARAMS, externalSubmissionId: 'mark-created' }, 'mock');
    const updated = await markCaseCreated(submission.id, 'real-case-id-2', 'mock');
    expect(updated?.createdCaseId).toBe('real-case-id-2');
  });
});
