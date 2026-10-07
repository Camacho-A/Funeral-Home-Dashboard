import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  caseFormLinkFixtures,
  externalFormSubmissionFixtures,
  externalFormConfigFixtures,
  FIRST_CALL_SHEET_FORM_CONFIG_ID,
} from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import {
  FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
  ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
} from '@/domain/externalForms/fieldMapping';
import {
  createExternalFormIntakeAuthorization,
  verifyExternalFormIntakeAuthorization,
} from '@/lib/auth/externalFormIntakeAuthorization';

/**
 * Automated first-call intake (2026-10). A submission from a form
 * configured `purpose: 'case_create'` creates exactly one Solis case; a
 * submission from any other form still never creates one.
 *
 * The PDF and document side effects are stubbed exactly as the sibling
 * webhook suite stubs them — this file is about case creation, not PDF
 * preservation.
 */
vi.mock('@/lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jotform/jotformClient')>('@/lib/jotform/jotformClient');
  return { ...actual, fetchSubmissionPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 synthetic')) };
});
vi.mock('@/services/documentService', async () => {
  const actual = await vi.importActual<typeof import('@/services/documentService')>('@/services/documentService');
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-first-call-test' }) };
});

const FIRST_CALL_AUTH_QID = '26';
const ARRANGEMENT_AUTH_QID = '275';
const TEST_SECRET = 'test-shared-secret';

/**
 * The service creates a case by calling `POST /api/cases` over a real
 * `fetch`. In this environment there is no server listening, so `fetch`
 * is stubbed to invoke the route handler directly — the request body,
 * headers, and the handler's own validation are all genuinely exercised,
 * only the network hop is removed.
 */
let casePostBodies: Record<string, unknown>[] = [];
let casePostResponder: ((body: Record<string, unknown>) => { status: number; json: unknown }) | null = null;

function stubCaseCreationFetch() {
  casePostBodies = [];
  let nextCaseNumber = 900;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.endsWith('/api/cases')) throw new Error(`Unexpected fetch to ${url}`);
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      casePostBodies.push(body);
      const result = casePostResponder
        ? casePostResponder(body)
        : {
            status: 201,
            json: {
              case: { id: `case-created-${casePostBodies.length}`, caseNumber: `B2026-${nextCaseNumber++}` },
            },
          };
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.json,
      };
    }),
  );
}

function webhookRequest(fields: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.set(key, value);
  return new Request('http://localhost/api/webhooks/jotform', {
    method: 'POST',
    body: params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

/** A complete, realistic First Call Sheet answer set, keyed by the real
    qids confirmed from the live form's own /questions response. */
function firstCallAnswers(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    [`${FIRST_CALL_AUTH_QID}_soliswebhookauth`]: TEST_SECRET,
    '3_nameof': { first: 'MARGARET', last: 'OKONKWO' },
    '6_dateOf6': '03/14/1941',
    '7_weight': '150 lb',
    '8_dateof': '10/02/2026',
    '9_timeof': '14:20',
    '20_placeOf': { addr_line1: '481 NW 1ST AVE', city: 'FORT LAUDERDALE', state: 'FL' },
    '22_nextOf': { first: 'DANIEL', last: 'OKONKWO' },
    '23_nextOf23': { full: '(954) 555-0142' },
    '24_nextOf24': 'daniel.okonkwo@example.test',
    ...overrides,
  });
}

let lengths: Record<string, number> = {};

beforeEach(() => {
  process.env.JOTFORM_WEBHOOK_SHARED_SECRET = TEST_SECRET;
  process.env.SESSION_SECRET ??= 'test-session-secret-for-intake-tokens';
  lengths = {
    links: caseFormLinkFixtures.length,
    submissions: externalFormSubmissionFixtures.length,
    activity: activityEventFixtures.length,
    configs: externalFormConfigFixtures.length,
    cases: caseFixtures.length,
  };
  stubCaseCreationFetch();
});

afterEach(() => {
  delete process.env.JOTFORM_WEBHOOK_SHARED_SECRET;
  caseFormLinkFixtures.length = lengths.links;
  externalFormSubmissionFixtures.length = lengths.submissions;
  activityEventFixtures.length = lengths.activity;
  externalFormConfigFixtures.length = lengths.configs;
  caseFixtures.length = lengths.cases;
  casePostResponder = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('First Call Sheet — creates exactly one case', () => {
  it('recognizes the configured First Call form and resolves its organization from config, not the payload', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
        submissionID: 'fc-sub-1',
        rawRequest: firstCallAnswers(),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, caseCreated: true });
    expect(casePostBodies).toHaveLength(1);
    expect(casePostBodies[0].organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('maps the First Call fields onto the correct canonical Case fields', async () => {
    const { POST } = await import('./route');
    await POST(
      webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-sub-2', rawRequest: firstCallAnswers() }),
    );

    const body = casePostBodies[0];
    expect(body.decedentName).toBe('MARGARET OKONKWO');
    expect(body.dateOfBirth).toBe('03/14/1941'); // qid 6 is DATE OF BIRTH on this form
    expect(body.dateOfDeath).toBe('10/02/2026'); // qid 8
    expect(body.nextOfKinName).toBe('DANIEL OKONKWO');
    expect(body.nextOfKinPhone).toBe('(954) 555-0142');
    expect(body.nextOfKinEmail).toBe('daniel.okonkwo@example.test'); // qid 24 is EMAIL on this form
    expect(body.weight).toBe('150 lb');
    expect(body.placeOfDeath).toBe('481 NW 1ST AVE');
  });

  it('never sends a case number — a first call takes the next one from the normal sequence', async () => {
    const { POST } = await import('./route');
    await POST(
      webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-sub-3', rawRequest: firstCallAnswers() }),
    );

    expect(casePostBodies[0]).not.toHaveProperty('caseNumber');
    expect(casePostBodies[0]).not.toHaveProperty('historicalCaseNumberAuthorization');
  });

  it('presents a valid intake authorization bound to this organization, form, and submission', async () => {
    const { POST } = await import('./route');
    await POST(
      webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-sub-4', rawRequest: firstCallAnswers() }),
    );

    const token = casePostBodies[0].externalFormIntakeAuthorization as string;
    expect(typeof token).toBe('string');
    const payload = await verifyExternalFormIntakeAuthorization(token);
    expect(payload).not.toBeNull();
    expect(payload!.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(payload!.externalFormId).toBe(FIRST_CALL_SHEET_EXTERNAL_FORM_ID);
    expect(payload!.externalSubmissionId).toBe('fc-sub-4');
    expect(payload!.intakeStaffProfileId).toBeTruthy();
  });

  it('records the submission so it is traceable back to the case it created', async () => {
    const { POST } = await import('./route');
    await POST(
      webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-sub-5', rawRequest: firstCallAnswers() }),
    );

    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'fc-sub-5');
    expect(stored).toBeDefined();
    expect(stored!.externalFormId).toBe(FIRST_CALL_SHEET_EXTERNAL_FORM_ID);
    expect(stored!.createdCaseId).toBe('case-created-1');
  });
});

describe('First Call Sheet — duplicate delivery', () => {
  it('creates exactly one case when the same submission is delivered twice', async () => {
    const { POST } = await import('./route');
    const deliver = () =>
      POST(webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-dupe', rawRequest: firstCallAnswers() }));

    const first = await deliver();
    const second = await deliver();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(casePostBodies).toHaveLength(1); // the decisive assertion
    expect(externalFormSubmissionFixtures.filter((s) => s.externalSubmissionId === 'fc-dupe')).toHaveLength(1);
  });

  it('acknowledges the redelivery rather than failing it', async () => {
    const { POST } = await import('./route');
    await POST(webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-dupe-2', rawRequest: firstCallAnswers() }));
    const second = await POST(
      webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-dupe-2', rawRequest: firstCallAnswers() }),
    );
    expect(await second.json()).toEqual({ received: true });
  });
});

describe('Only a case_create form may create a case', () => {
  it('an Arrangement submission with no link token is still stored unmatched, never created', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
        submissionID: 'arr-no-link',
        rawRequest: JSON.stringify({ [`${ARRANGEMENT_AUTH_QID}_soliswebhookauth`]: TEST_SECRET }),
      }),
    );

    expect(response.status).toBe(200);
    expect(casePostBodies).toHaveLength(0);
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'arr-no-link');
    expect(stored!.status).toBe('unmatched');
    expect(stored!.createdCaseId).toBeNull();
  });

  it('a config without the case_create purpose cannot create, even from the First Call form id', async () => {
    const config = externalFormConfigFixtures.find((c) => c.id === FIRST_CALL_SHEET_FORM_CONFIG_ID)!;
    const original = config.purpose;
    config.purpose = 'case_update';
    try {
      const { POST } = await import('./route');
      await POST(
        webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-downgraded', rawRequest: firstCallAnswers() }),
      );
      expect(casePostBodies).toHaveLength(0);
    } finally {
      config.purpose = original;
    }
  });
});

describe('First Call Sheet — fails safely', () => {
  it('does not create a case when a required field is missing, leaving the submission unmatched', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
        submissionID: 'fc-missing',
        // No decedent name.
        rawRequest: firstCallAnswers({ '3_nameof': { first: '', last: '' } }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, caseCreated: false });
    expect(casePostBodies).toHaveLength(0);
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'fc-missing');
    expect(stored!.status).toBe('unmatched');
    expect(stored!.createdCaseId).toBeNull();
  });

  it('leaves no half-created state when case creation itself fails', async () => {
    casePostResponder = () => ({ status: 422, json: { case: null, error: 'synthetic failure' } });
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: 'fc-fail', rawRequest: firstCallAnswers() }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, caseCreated: false });
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'fc-fail');
    // The creation claim must be released, not left latched, so the row
    // stays recoverable through Unmatched Forms.
    expect(stored!.createdCaseId).toBeNull();
  });

  it('still rejects an unverified request before any creation is attempted', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
        submissionID: 'fc-badauth',
        rawRequest: firstCallAnswers({ [`${FIRST_CALL_AUTH_QID}_soliswebhookauth`]: 'wrong-secret' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(casePostBodies).toHaveLength(0);
  });
});

describe('Intake authorization token', () => {
  const base = {
    organizationId: DEFAULT_ORGANIZATION_ID,
    externalFormId: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
    externalSubmissionId: 'sub-token-1',
    intakeStaffProfileId: 'staff-dana',
  };

  it('round-trips a valid token', async () => {
    const payload = await verifyExternalFormIntakeAuthorization(await createExternalFormIntakeAuthorization(base));
    expect(payload).toMatchObject(base);
  });

  it('rejects a tampered payload', async () => {
    const token = await createExternalFormIntakeAuthorization(base);
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...base, organizationId: SECOND_MOCK_ORGANIZATION_ID }))
      .toString('base64url');
    expect(await verifyExternalFormIntakeAuthorization(`${forged}.${signature}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const issued = Math.floor(Date.now() / 1000);
    const token = await createExternalFormIntakeAuthorization(base, issued);
    expect(await verifyExternalFormIntakeAuthorization(token, issued + 10 * 60)).toBeNull();
  });

  it('rejects a malformed token', async () => {
    expect(await verifyExternalFormIntakeAuthorization('not-a-token')).toBeNull();
    expect(await verifyExternalFormIntakeAuthorization('')).toBeNull();
  });
});
