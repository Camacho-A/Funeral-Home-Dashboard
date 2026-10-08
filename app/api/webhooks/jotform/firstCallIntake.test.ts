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
 * Server-side authentication (2026-10): the case a webhook creates is
 * built from answers retrieved through Jotform's authenticated API, not
 * from the POST body — so `submissionApiRecords` below is what supplies
 * the answers here, and the body carries only the two claims. The retired
 * hidden-field shared secret is gone; see the sibling route suite.
 *
 * The PDF and document side effects are stubbed exactly as that sibling
 * suite stubs them — this file is about case creation, not PDF
 * preservation.
 */
const { submissionApiRecords } = vi.hoisted(() => ({
  submissionApiRecords: new Map<
    string,
    { formId: string; submittedAt: string | null; answers: Record<string, { answer: string | Record<string, string> }> }
  >(),
}));

vi.mock('@/lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jotform/jotformClient')>('@/lib/jotform/jotformClient');
  return {
    ...actual,
    fetchSubmissionPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 synthetic')),
    fetchSubmissionAnswers: vi.fn(async (submissionId: string) => {
      const record = submissionApiRecords.get(submissionId);
      if (!record) {
        throw new actual.JotformClientError('Jotform submission retrieval failed with status 401.', 'http_error');
      }
      return record;
    }),
  };
});
vi.mock('@/services/documentService', async () => {
  const actual = await vi.importActual<typeof import('@/services/documentService')>('@/services/documentService');
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-first-call-test' }) };
});

/** Real Jotform submission ids are numeric; the handler shape-checks them
    before spending an API call. */
const SUB = {
  recognizes: '2000000000000000001',
  maps: '2000000000000000002',
  noCaseNumber: '2000000000000000003',
  token: '2000000000000000004',
  traceable: '2000000000000000005',
  dupe: '2000000000000000006',
  dupe2: '2000000000000000007',
  arrangementNoLink: '2000000000000000008',
  downgraded: '2000000000000000009',
  missingField: '2000000000000000010',
  creationFails: '2000000000000000011',
  unconfirmed: '2000000000000000012',
  crossForm: '2000000000000000013',
};

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

/** Jotform's own `created_at` serialization: no timezone offset. */
function jotformTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

/** The real `control_time` answer shape qid 9 returns, taken from the
    first live automated intake (submission 6673017618712656713). Note the
    vestigial `ampm: 'PM'` that Jotform emits even though the question is
    configured `timeFormat: '24 Hour'`. */
const FIRST_CALL_TIME_ANSWER = { timeInput: '11:30', hourSelect: '11', minuteSelect: '30', ampm: 'PM' };
const FIRST_CALL_TIME_FORMATS = { '9': '24 Hour' };

/** A complete, realistic Manors First Call Sheet answer set, keyed by the real
    qids confirmed from the live form's own /questions response — in the
    bare-qid shape `GET /submission/{id}` returns. */
function firstCallAnswers(
  overrides: Record<string, string | Record<string, string>> = {},
): Record<string, string | Record<string, string>> {
  return {
    '3': { first: 'MARGARET', last: 'OKONKWO' },
    '6': '03/14/1941',
    '7': '150 lb',
    '8': '10/02/2026',
    '9': FIRST_CALL_TIME_ANSWER,
    '20': { addr_line1: '481 NW 1ST AVE', city: 'FORT LAUDERDALE', state: 'FL' },
    '22': { first: 'DANIEL', last: 'OKONKWO' },
    '23': { full: '(954) 555-0142' },
    '24': 'daniel.okonkwo@example.test',
    ...overrides,
  };
}

/** Registers what Jotform's authenticated API will report for one
    submission — the authoritative source the handler reads. */
function givenJotformHasSubmission(params: {
  formId: string;
  submissionId: string;
  answers?: Record<string, string | Record<string, string>>;
  /** Per-qid `timeFormat`, as Jotform reports it for `control_time`
      questions — carried through because a compound time answer cannot be
      interpreted without it. */
  timeFormats?: Record<string, string>;
  submittedAt?: string | null;
}) {
  const answers: Record<string, { answer: string | Record<string, string>; timeFormat?: string }> = {};
  for (const [qid, value] of Object.entries(params.answers ?? {})) {
    const timeFormat = params.timeFormats?.[qid];
    answers[qid] = { answer: value, ...(timeFormat ? { timeFormat } : {}) };
  }
  submissionApiRecords.set(params.submissionId, {
    formId: params.formId,
    submittedAt: params.submittedAt === undefined ? jotformTimestamp() : params.submittedAt,
    answers,
  });
}

/** Registers a complete First Call submission and delivers its webhook. */
async function deliverFirstCall(
  submissionId: string,
  overrides: Record<string, string | Record<string, string>> = {},
) {
  givenJotformHasSubmission({
    formId: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
    submissionId,
    answers: firstCallAnswers(overrides),
    timeFormats: FIRST_CALL_TIME_FORMATS,
  });
  const { POST } = await import('./route');
  return POST(webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: submissionId }));
}

let lengths: Record<string, number> = {};

beforeEach(() => {
  process.env.JOTFORM_API_KEY = 'test-api-key';
  process.env.SESSION_SECRET ??= 'test-session-secret-for-intake-tokens';
  submissionApiRecords.clear();
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
  delete process.env.JOTFORM_API_KEY;
  submissionApiRecords.clear();
  caseFormLinkFixtures.length = lengths.links;
  externalFormSubmissionFixtures.length = lengths.submissions;
  activityEventFixtures.length = lengths.activity;
  externalFormConfigFixtures.length = lengths.configs;
  caseFixtures.length = lengths.cases;
  casePostResponder = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Manors First Call Sheet — creates exactly one case', () => {
  it('recognizes the configured First Call form and resolves its organization from config, not the payload', async () => {
    const response = await deliverFirstCall(SUB.recognizes);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, caseCreated: true });
    expect(casePostBodies).toHaveLength(1);
    expect(casePostBodies[0].organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('maps the First Call fields onto the correct canonical Case fields', async () => {
    await deliverFirstCall(SUB.maps);

    const body = casePostBodies[0];
    expect(body.decedentName).toBe('MARGARET OKONKWO');
    expect(body.dateOfBirth).toBe('03/14/1941'); // qid 6 is DATE OF BIRTH on this form
    expect(body.dateOfDeath).toBe('10/02/2026'); // qid 8
    expect(body.nextOfKinName).toBe('DANIEL OKONKWO');
    expect(body.nextOfKinPhone).toBe('(954) 555-0142');
    expect(body.nextOfKinEmail).toBe('daniel.okonkwo@example.test'); // qid 24 is EMAIL on this form
    expect(body.weight).toBe('150 lb');
    expect(body.placeOfDeath).toBe('481 NW 1ST AVE');
    // qid 9 is a compound `control_time` answer. Live-intake fix (2026-10):
    // this previously mapped to nothing at all, so the created case was
    // given a blank Time of Death. The vestigial `ampm: 'PM'` must NOT be
    // applied to a question configured 24-hour — 23:30 would be wrong by
    // twelve hours.
    expect(body.timeOfDeath).toBe('11:30');
  });

  it('builds the case from Jotform\'s own answers, never from the webhook body', async () => {
    // A forged body claiming an entirely different decedent, paired with a
    // genuine submission id. The body must contribute nothing.
    givenJotformHasSubmission({
      formId: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
      submissionId: SUB.recognizes,
      answers: firstCallAnswers(),
      timeFormats: FIRST_CALL_TIME_FORMATS,
    });
    const { POST } = await import('./route');
    await POST(
      webhookRequest({
        formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
        submissionID: SUB.recognizes,
        rawRequest: JSON.stringify({
          '3_nameof': { first: 'FORGED', last: 'IDENTITY' },
          '23_nextOf23': { full: '(000) 000-0000' },
        }),
      }),
    );

    expect(casePostBodies).toHaveLength(1);
    expect(casePostBodies[0].decedentName).toBe('MARGARET OKONKWO');
    expect(casePostBodies[0].nextOfKinPhone).toBe('(954) 555-0142');
    expect(JSON.stringify(casePostBodies[0])).not.toContain('FORGED');
  });

  it('never sends a case number — a first call takes the next one from the normal sequence', async () => {
    await deliverFirstCall(SUB.noCaseNumber);

    expect(casePostBodies[0]).not.toHaveProperty('caseNumber');
    expect(casePostBodies[0]).not.toHaveProperty('historicalCaseNumberAuthorization');
  });

  it('presents a valid intake authorization bound to this organization, form, and submission', async () => {
    await deliverFirstCall(SUB.token);

    const token = casePostBodies[0].externalFormIntakeAuthorization as string;
    expect(typeof token).toBe('string');
    const payload = await verifyExternalFormIntakeAuthorization(token);
    expect(payload).not.toBeNull();
    expect(payload!.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(payload!.externalFormId).toBe(FIRST_CALL_SHEET_EXTERNAL_FORM_ID);
    expect(payload!.externalSubmissionId).toBe(SUB.token);
    expect(payload!.intakeStaffProfileId).toBeTruthy();
  });

  it('records the submission so it is traceable back to the case it created', async () => {
    await deliverFirstCall(SUB.traceable);

    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.traceable);
    expect(stored).toBeDefined();
    expect(stored!.externalFormId).toBe(FIRST_CALL_SHEET_EXTERNAL_FORM_ID);
    expect(stored!.createdCaseId).toBe('case-created-1');
  });

  it('does NOT leave the submission sitting in the Unmatched Forms queue after it created a case', async () => {
    // Live-intake finding (2026-10): a `case_create` submission never
    // resolves a CaseFormLink, so it was stored `unmatched` and only
    // `createdCaseId` was written afterwards. `listUnmatched` filters on
    // status alone, so a submission that had already created B2026-037
    // still showed up as needing manual linking.
    await deliverFirstCall(SUB.traceable);

    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.traceable);
    expect(stored!.status).toBe('matched');

    const { listUnmatched } = await import('@/services/externalFormSubmissionService');
    const queue = await listUnmatched(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(queue.map((s) => s.externalSubmissionId)).not.toContain(SUB.traceable);
  });

  it('still leaves a submission that did NOT create a case in the queue for staff', async () => {
    // The counterpart direction: the fix must not hide genuine failures.
    await deliverFirstCall(SUB.missingField, { '3': { first: '', last: '' } });

    const { listUnmatched } = await import('@/services/externalFormSubmissionService');
    const queue = await listUnmatched(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(queue.map((s) => s.externalSubmissionId)).toContain(SUB.missingField);
  });
});

describe('Manors First Call Sheet — duplicate delivery', () => {
  it('creates exactly one case when the same submission is delivered twice', async () => {
    const first = await deliverFirstCall(SUB.dupe);
    const second = await deliverFirstCall(SUB.dupe);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(casePostBodies).toHaveLength(1); // the decisive assertion
    expect(externalFormSubmissionFixtures.filter((s) => s.externalSubmissionId === SUB.dupe)).toHaveLength(1);
  });

  it('acknowledges the redelivery rather than failing it', async () => {
    await deliverFirstCall(SUB.dupe2);
    const second = await deliverFirstCall(SUB.dupe2);
    expect(await second.json()).toEqual({ received: true });
  });
});

describe('Only a case_create form may create a case', () => {
  it('an Arrangement submission with no link token is still stored unmatched, never created', async () => {
    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      submissionId: SUB.arrangementNoLink,
    });
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, submissionID: SUB.arrangementNoLink }),
    );

    expect(response.status).toBe(200);
    expect(casePostBodies).toHaveLength(0);
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrangementNoLink);
    expect(stored!.status).toBe('unmatched');
    expect(stored!.createdCaseId).toBeNull();
  });

  it('a config without the case_create purpose cannot create, even from the First Call form id', async () => {
    const config = externalFormConfigFixtures.find((c) => c.id === FIRST_CALL_SHEET_FORM_CONFIG_ID)!;
    const original = config.purpose;
    config.purpose = 'case_update';
    try {
      await deliverFirstCall(SUB.downgraded);
      expect(casePostBodies).toHaveLength(0);
    } finally {
      config.purpose = original;
    }
  });
});

describe('Manors First Call Sheet — fails safely', () => {
  it('does not create a case when a required field is missing, leaving the submission unmatched', async () => {
    // No decedent name.
    const response = await deliverFirstCall(SUB.missingField, { '3': { first: '', last: '' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, caseCreated: false });
    expect(casePostBodies).toHaveLength(0);
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.missingField);
    expect(stored!.status).toBe('unmatched');
    expect(stored!.createdCaseId).toBeNull();
  });

  it('leaves no half-created state when case creation itself fails', async () => {
    casePostResponder = () => ({ status: 422, json: { case: null, error: 'synthetic failure' } });
    const response = await deliverFirstCall(SUB.creationFails);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, caseCreated: false });
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.creationFails);
    // The creation claim must be released, not left latched, so the row
    // stays recoverable through Unmatched Forms.
    expect(stored!.createdCaseId).toBeNull();
  });

  it('rejects a delivery Jotform will not confirm, before any creation is attempted', async () => {
    // Nothing registered — the live API answers 401 for a submission this
    // account does not own. A forged first-call delivery therefore cannot
    // reach case creation at all.
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
        submissionID: SUB.unconfirmed,
        rawRequest: JSON.stringify({ '3_nameof': { first: 'FORGED', last: 'INTAKE' } }),
      }),
    );
    expect(response.status).toBe(401);
    expect(casePostBodies).toHaveLength(0);
    expect(externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.unconfirmed)).toBeUndefined();
  });

  it('refuses to create a case from a submission Jotform reports on a different form', async () => {
    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      submissionId: SUB.crossForm,
      answers: firstCallAnswers(),
    });
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: FIRST_CALL_SHEET_EXTERNAL_FORM_ID, submissionID: SUB.crossForm }),
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
