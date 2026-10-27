import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures } from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { ARRANGEMENT_FORMS_EXTERNAL_FORM_ID } from '@/domain/externalForms/fieldMapping';

/**
 * Unmatched Forms → No action needed (2026-10). Runs the real route and the
 * real submission service in mock mode, with fictional data only.
 */
let authorizedOrganizationId = DEFAULT_ORGANIZATION_ID;
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) => {
    if (requested !== authorizedOrganizationId) {
      return { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) };
    }
    return { authorized: true, context: { organizationId: requested, userId: 'staff-dana', role: 'administrator' } };
  }),
}));

const { POST } = await import('./route');
const { receive, listUnmatched, getById } = await import('@/services/externalFormSubmissionService');

let lengths = { submissions: 0, links: 0, activity: 0, cases: 0 };
beforeEach(() => {
  authorizedOrganizationId = DEFAULT_ORGANIZATION_ID;
  lengths = { submissions: externalFormSubmissionFixtures.length, links: caseFormLinkFixtures.length, activity: activityEventFixtures.length, cases: caseFixtures.length };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test'); }));
});
afterEach(() => {
  externalFormSubmissionFixtures.length = lengths.submissions;
  caseFormLinkFixtures.length = lengths.links;
  activityEventFixtures.length = lengths.activity;
  caseFixtures.length = lengths.cases;
  vi.unstubAllGlobals();
});

async function seedUnmatched(externalSubmissionId: string, organizationId = DEFAULT_ORGANIZATION_ID) {
  const { submission } = await receive(
    {
      organizationId,
      provider: 'jotform',
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId,
      caseFormLinkId: null,
      mappedFields: JSON.stringify({ decedentName: 'FICTIONAL PERSON', dateOfDeath: '10/25/2026' }),
      pdfStatus: 'pending',
    },
    'mock',
  );
  return submission;
}

function post(submissionId: string, body: unknown, origin = 'http://localhost') {
  return new Request(`http://localhost/api/external-form-submissions/${submissionId}/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/external-form-submissions/[submissionId]/dismiss', () => {
  it('clears the submission from Unmatched Forms, keeps the row, records who did it, and touches no case', async () => {
    const submission = await seedUnmatched('dismiss-test-1');
    expect((await listUnmatched(DEFAULT_ORGANIZATION_ID, 'mock')).some((s) => s.id === submission.id)).toBe(true);
    const casesBefore = JSON.stringify(caseFixtures);
    const linksBefore = caseFormLinkFixtures.length;

    const response = await POST(post(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), { params: Promise.resolve({ submissionId: submission.id }) });

    expect(response.status).toBe(200);
    expect((await listUnmatched(DEFAULT_ORGANIZATION_ID, 'mock')).some((s) => s.id === submission.id)).toBe(false);
    const kept = await getById(submission.id, 'mock');
    expect(kept).toMatchObject({ status: 'dismissed', reviewedBy: 'staff-dana', mappedFields: submission.mappedFields, caseFormLinkId: null, createdCaseId: null });
    expect(kept!.reviewedAt).toEqual(expect.any(String));
    expect(JSON.stringify(caseFixtures)).toBe(casesBefore);
    expect(caseFormLinkFixtures.length).toBe(linksBefore);
    const event = activityEventFixtures.find((e) => e.eventType === 'external_form.submission_dismissed' && e.resourceId === submission.id);
    expect(event).toMatchObject({ caseId: null, category: 'external_form', actorIdentityId: 'staff-dana' });
    expect(event!.description).toContain('cleared from Unmatched Forms — no action needed');
  });

  it('refuses a submission that is no longer unmatched (409) and changes nothing', async () => {
    const submission = await seedUnmatched('dismiss-test-2');
    await POST(post(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), { params: Promise.resolve({ submissionId: submission.id }) });
    const again = await POST(post(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), { params: Promise.resolve({ submissionId: submission.id }) });
    expect(again.status).toBe(409);
  });

  it("never clears another organization's submission (404)", async () => {
    const other = await seedUnmatched('dismiss-test-3', SECOND_MOCK_ORGANIZATION_ID);
    const response = await POST(post(other.id, { organizationId: DEFAULT_ORGANIZATION_ID }), { params: Promise.resolve({ submissionId: other.id }) });
    expect(response.status).toBe(404);
    expect((await getById(other.id, 'mock'))!.status).toBe('unmatched');
  });

  it('rejects a cross-origin request and an unauthorized organization', async () => {
    const submission = await seedUnmatched('dismiss-test-4');
    const crossOrigin = await POST(post(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }, 'http://evil.test'), { params: Promise.resolve({ submissionId: submission.id }) });
    expect(crossOrigin.status).toBe(403);
    authorizedOrganizationId = 'someone-else';
    const unauthorized = await POST(post(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), { params: Promise.resolve({ submissionId: submission.id }) });
    expect(unauthorized.status).toBe(403);
    expect((await getById(submission.id, 'mock'))!.status).toBe('unmatched');
  });
});
