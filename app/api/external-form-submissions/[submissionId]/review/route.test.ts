import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures } from '@/services/__mocks__/externalFormFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn().mockResolvedValue({
    authorized: true,
    context: { organizationId: 'managed-cremations', userId: 'staff-1', role: 'administrator' },
  }),
}));

const TEST_CASE_ID = 'review-route-case-1';

function seedCase(overrides: Partial<(typeof caseFixtures)[number]> = {}) {
  const base = { ...caseFixtures[0] };
  const testCase = { ...base, id: TEST_CASE_ID, organizationId: 'managed-cremations', ...overrides };
  caseFixtures.push(testCase);
  return testCase;
}

function reviewRequest(method: 'GET' | 'POST', body?: unknown, query?: string) {
  const url = `http://localhost/api/external-form-submissions/x/review${query ? `?${query}` : ''}`;
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let caseFormLinkLengthBefore: number;
let submissionLengthBefore: number;
let caseLengthBefore: number;
let activityLengthBefore: number;
beforeEach(() => {
  caseFormLinkLengthBefore = caseFormLinkFixtures.length;
  submissionLengthBefore = externalFormSubmissionFixtures.length;
  caseLengthBefore = caseFixtures.length;
  activityLengthBefore = activityEventFixtures.length;
});
afterEach(() => {
  caseFormLinkFixtures.length = caseFormLinkLengthBefore;
  externalFormSubmissionFixtures.length = submissionLengthBefore;
  caseFixtures.length = caseLengthBefore;
  activityEventFixtures.length = activityLengthBefore;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/external-form-submissions/[submissionId]/review', () => {
  it('classifies matching, empty, and conflicting fields correctly', async () => {
    seedCase({ nextOfKinEmail: null, dateOfBirth: '01/02/1950' });
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '262605621454050',
        externalSubmissionId: 'review-sub-1',
        caseFormLinkId: null,
        mappedFields: JSON.stringify({ nextOfKinEmail: 'family@example.com', dateOfBirth: '01/03/1950' }),
        pdfStatus: 'not_applicable',
      },
      'mock',
    );

    const { GET } = await import('./route');
    const response = await GET(
      reviewRequest('GET', undefined, `organizationId=managed-cremations&caseId=${TEST_CASE_ID}`),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const byField = Object.fromEntries(body.rows.map((r: { field: string; state: string }) => [r.field, r.state]));
    expect(byField.nextOfKinEmail).toBe('solis_empty');
    expect(byField.dateOfBirth).toBe('conflict');
  });
});

describe('POST /api/external-form-submissions/[submissionId]/review — apply', () => {
  it('applies only the selected fields through the existing case-update route, via a same-origin-shaped internal request', async () => {
    seedCase({ nextOfKinEmail: null });
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '262605621454050',
        externalSubmissionId: 'review-sub-apply',
        caseFormLinkId: null,
        mappedFields: JSON.stringify({ nextOfKinEmail: 'family@example.com' }),
        pdfStatus: 'not_applicable',
      },
      'mock',
    );

    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ case: { id: TEST_CASE_ID } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const response = await POST(
      reviewRequest('POST', { organizationId: 'managed-cremations', caseId: TEST_CASE_ID, fieldsToApply: ['nextOfKinEmail'], expectedRevision: 0 }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain(`/api/cases/${TEST_CASE_ID}`);
    expect(calledInit.method).toBe('PATCH');
    const sentBody = JSON.parse(calledInit.body);
    expect(sentBody.patch).toEqual({ nextOfKinEmail: 'family@example.com' });
    // The revision the review was computed against is forwarded (2026-10).
    expect(sentBody.expectedRevision).toBe(0);

    const reviewed = await import('@/services/externalFormSubmissionService').then((m) => m.getById(submission.id, 'mock'));
    expect(reviewed?.status).toBe('reviewed');
  });

  it('marks reviewed without calling the case-update route at all when no fields are selected', async () => {
    seedCase();
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '262605621454050',
        externalSubmissionId: 'review-sub-noop',
        caseFormLinkId: null,
        mappedFields: JSON.stringify({}),
        pdfStatus: 'not_applicable',
      },
      'mock',
    );

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const response = await POST(
      reviewRequest('POST', { organizationId: 'managed-cremations', caseId: TEST_CASE_ID, fieldsToApply: [] }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/external-form-submissions/[submissionId]/review — workflow progression (Task #1, 2026-09)', () => {
  /** Root cause fix: this route's own state changes (marking a
      submission's CaseFormLink reviewed, applying a reconciled field) can
      be exactly the event that makes an earlier stage newly complete, but
      this route never called reconcileCaseWorkflow at all — so a case
      could remain stuck even after staff completed the review here. */
  it('marking a submission reviewed (no fields applied) still reconciles — a CaseFormLink transitioning to reviewed is itself a completion-relevant event', async () => {
    const { standardCremationWorkflowTemplateFixture } = await import('@/services/__mocks__/workflowTemplates');
    const { buildCaseWorkflowSnapshot } = await import('@/domain/workflow/snapshot');
    const { caseFormLinkFixtures: linkFixtures, ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const version = standardCremationWorkflowTemplateFixture.versions[0];
    const caseId = 'review-route-progression-noop-fields';
    const base = seedCase({
      id: caseId,
      rawStage: 0,
      dateOfBirth: 'X',
      // displayStage 0 — composite-keyed per B2026-035's fix
      // (domain/workflow/checklistItemKey.ts). Checklist default-done fix
      // (2026-10): displayStage 0's rawStage-1 StageTemplate twin treats
      // these same local indices 0-7 as manual, so they need an explicit
      // composite key too — not just the historical 8/9/10.
      checklistState: {
        '0:0': true,
        '0:1': true,
        '0:2': true,
        '0:3': true,
        '0:4': true,
        '0:5': true,
        '0:6': true,
        '0:7': true,
        '0:8': true,
        '0:9': true,
        '0:10': true,
      },
      fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X', 9: 'X', 10: 'X' },
      workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
      workflowTemplateVersion: version.version,
      workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, version),
    });
    void base;
    linkFixtures.push({
      id: `link-${caseId}`,
      organizationId: 'managed-cremations',
      caseId,
      provider: 'jotform',
      formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID,
      linkTokenHash: 'hash',
      status: 'received',
      sentAt: '2026-01-01T00:00:00.000Z',
      submissionId: `sub-${caseId}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '262605621454050',
        externalSubmissionId: 'review-progression-sub-noop',
        caseFormLinkId: `link-${caseId}`,
        mappedFields: JSON.stringify({}),
        pdfStatus: 'not_applicable',
      },
      'mock',
    );

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const response = await POST(
      reviewRequest('POST', { organizationId: 'managed-cremations', caseId, fieldsToApply: [] }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled(); // still no field patch — nothing to apply
    const updated = caseFixtures.find((c) => c.id === caseId);
    expect(updated?.rawStage).toBe(3); // reconciliation ran anyway and correctly advanced the case
  });
});

/**
 * Certifier block (2026-10). An Arrangement Form arriving for an EXISTING
 * case supplies the certifier the funeral director filled in (qids 137-140:
 * name, phone, license number, fax). Each is offered when the case has none
 * and included in "Apply all new information"; a different value already
 * on the case is a conflict staff must choose explicitly. (Before, only
 * the fax could be applied — name, phone and license were review-only.)
 */
describe('review — certifier block from an Arrangement submission', () => {
  async function receiveArrangement(externalSubmissionId: string, mapped: Record<string, string>) {
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '261945978664175',
        externalSubmissionId,
        caseFormLinkId: null,
        mappedFields: JSON.stringify(mapped),
        pdfStatus: 'not_applicable',
      },
      'mock',
    );
    return submission;
  }

  const CERTIFIER = { certifierName: 'DR. ROWAN EASTWICK', certifierPhone: '954-777-0000', certifierLicenseNumber: 'ME-40211', certifierFax: '954-777-2262' };

  async function rows(submissionId: string) {
    const { GET } = await import('./route');
    const response = await GET(reviewRequest('GET', undefined, `organizationId=managed-cremations&caseId=${TEST_CASE_ID}`), {
      params: Promise.resolve({ submissionId }),
    });
    const body = await response.json();
    return Object.fromEntries(body.rows.map((r: { field: string; state: string; eligibleForBulkApply: boolean }) => [r.field, [r.state, r.eligibleForBulkApply]]));
  }

  it('offers every certifier field the case is missing, included in "Apply all new information"', async () => {
    seedCase({ certifierName: null, certifierPhone: null, certifierLicenseNumber: null, certifierFax: null });
    const submission = await receiveArrangement('review-cert-empty', CERTIFIER);
    const byField = await rows(submission.id);
    for (const field of Object.keys(CERTIFIER)) expect(byField[field]).toEqual(['solis_empty', true]);
  });

  it('a different value already on the case is a conflict, never pre-selected; the same value is a match', async () => {
    seedCase({ certifierName: 'DR. ROWAN EASTWICK', certifierPhone: '555-0199', certifierLicenseNumber: null, certifierFax: null });
    const submission = await receiveArrangement('review-cert-conflict', CERTIFIER);
    const byField = await rows(submission.id);
    expect(byField.certifierName).toEqual(['match', false]);
    expect(byField.certifierPhone).toEqual(['conflict', false]);
    expect(byField.certifierLicenseNumber).toEqual(['solis_empty', true]);
  });

  it('a submission with the certifier block left blank offers nothing to apply', async () => {
    seedCase({ certifierName: null, certifierPhone: null, certifierLicenseNumber: null, certifierFax: null });
    const submission = await receiveArrangement('review-cert-blank', { decedentName: 'JUNIPER FAIRWEATHER' });
    const byField = await rows(submission.id);
    for (const field of Object.keys(CERTIFIER)) expect(byField[field]?.[1] ?? false).toBe(false);
  });

  it('applying sends exactly the selected certifier fields through the case update', async () => {
    seedCase({ certifierName: null, certifierPhone: '555-0199', certifierLicenseNumber: null, certifierFax: null });
    const submission = await receiveArrangement('review-cert-apply', CERTIFIER);
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ case: { id: TEST_CASE_ID } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const response = await POST(
      reviewRequest('POST', {
        organizationId: 'managed-cremations',
        caseId: TEST_CASE_ID,
        fieldsToApply: ['certifierName', 'certifierLicenseNumber', 'certifierFax'],
        expectedRevision: 0,
      }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).patch).toEqual({
      certifierName: 'DR. ROWAN EASTWICK',
      certifierLicenseNumber: 'ME-40211',
      certifierFax: '954-777-2262',
    });
  });
});

/**
 * Case concurrency (2026-10). Applying form data is a case write like any
 * other: it must say which revision it was reviewed against, a stale review
 * is refused, and a linked submission can only be applied to its own case.
 */
describe('review apply — revisions and case ownership', () => {
  async function receiveDob(externalSubmissionId: string, caseFormLinkId: string | null = null) {
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      {
        organizationId: 'managed-cremations',
        provider: 'jotform',
        externalFormId: '262605621454050',
        externalSubmissionId,
        caseFormLinkId,
        mappedFields: JSON.stringify({ dateOfBirth: '01/03/1950' }),
        pdfStatus: 'not_applicable',
      },
      'mock',
    );
    return submission;
  }

  it('GET returns the case revision the rows were computed against', async () => {
    seedCase({ revision: 4 });
    const submission = await receiveDob('rev-get');
    const { GET } = await import('./route');
    const response = await GET(reviewRequest('GET', undefined, `organizationId=managed-cremations&caseId=${TEST_CASE_ID}`), {
      params: Promise.resolve({ submissionId: submission.id }),
    });
    expect((await response.json()).caseRevision).toBe(4);
  });

  it('refuses to apply fields without a revision (428), calling no case update', async () => {
    seedCase();
    const submission = await receiveDob('rev-missing');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const response = await POST(reviewRequest('POST', { organizationId: 'managed-cremations', caseId: TEST_CASE_ID, fieldsToApply: ['dateOfBirth'] }), {
      params: Promise.resolve({ submissionId: submission.id }),
    });
    expect(response.status).toBe(428);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes a 409 from the case update straight through, and does not mark the submission reviewed', async () => {
    seedCase();
    const submission = await receiveDob('rev-stale');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ case: null, error: 'changed', reason: 'revision_conflict' }), { status: 409 })),
    );
    const { POST } = await import('./route');
    const response = await POST(
      reviewRequest('POST', { organizationId: 'managed-cremations', caseId: TEST_CASE_ID, fieldsToApply: ['dateOfBirth'], expectedRevision: 0 }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe('revision_conflict');
    const { getById } = await import('@/services/externalFormSubmissionService');
    expect((await getById(submission.id, 'mock'))?.status).not.toBe('reviewed');
  });

  it('refuses to apply a LINKED submission to a different case', async () => {
    seedCase();
    caseFormLinkFixtures.push({
      id: 'link-other-case',
      organizationId: 'managed-cremations',
      caseId: 'some-other-case',
      provider: 'jotform',
      formConfigId: 'cfg',
      tokenHash: 'h',
      status: 'received',
      submissionId: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    } as never);
    const submission = await receiveDob('rev-linked', 'link-other-case');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const response = await POST(
      reviewRequest('POST', { organizationId: 'managed-cremations', caseId: TEST_CASE_ID, fieldsToApply: ['dateOfBirth'], expectedRevision: 0 }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );
    expect(response.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
