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
