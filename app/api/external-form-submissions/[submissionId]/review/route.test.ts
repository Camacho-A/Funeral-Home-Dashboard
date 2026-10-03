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
      reviewRequest('POST', { organizationId: 'managed-cremations', caseId: TEST_CASE_ID, fieldsToApply: ['nextOfKinEmail'] }),
      { params: Promise.resolve({ submissionId: submission.id }) },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain(`/api/cases/${TEST_CASE_ID}`);
    expect(calledInit.method).toBe('PATCH');
    const sentBody = JSON.parse(calledInit.body);
    expect(sentBody.patch).toEqual({ nextOfKinEmail: 'family@example.com' });

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
