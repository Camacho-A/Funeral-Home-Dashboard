import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  caseFormLinkFixtures,
  externalFormSubmissionFixtures,
  externalFormConfigFixtures,
  FIRST_CALL_SHEET_FORM_CONFIG_ID,
  ARRANGEMENT_FORMS_FORM_CONFIG_ID,
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
  arrCreates: '2000000000000000014',
  arrDupe: '2000000000000000015',
  fcAfterArr: '2000000000000000016',
  arrPdfFails: '2000000000000000017',
  mnFirstCall: '2000000000000000018',
  mnArrangement: '2000000000000000019',
  mnAbsent: '2000000000000000020',
  mnOtherPeople: '2000000000000000021',
  arrNoBranch: '2000000000000000017',
  arrConcurrentA: '2000000000000000018',
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

/**
 * A complete Arrangement Forms submission. Every qid here is `required`
 * on the live form (verified against the Jotform question metadata), so
 * this is the shape a real submission always has — notably qid 276, the
 * Yes/No branch that authorizes deriving Next of Kin from the Informant
 * block (qids 122/224/225).
 */
function arrangementAnswers(overrides: Record<string, string | Record<string, string>> = {}) {
  return {
    '87': { first: 'MARGARET', last: 'OKONKWO' },
    '8': '03/14/1951',
    '10': '10/09/2026',
    '122': { first: 'DANIEL', last: 'OKONKWO' },
    '224': { full: '(555) 330-1180' },
    '225': 'Son',
    '276': 'Yes',
    ...overrides,
  };
}

async function deliverArrangement(
  submissionId: string,
  overrides: Record<string, string | Record<string, string>> = {},
) {
  givenJotformHasSubmission({
    formId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
    submissionId,
    answers: arrangementAnswers(overrides),
  });
  const { POST } = await import('./route');
  return POST(webhookRequest({ formID: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, submissionID: submissionId }));
}

/**
 * Middle name from JotForm (2026-10). All three forms send the deceased
 * name as a structured {first, middle, last, suffix}; the middle is read
 * from the SAME question as first and last, never split out of a full
 * name string.
 */
describe('decedent middle name reaches the new case', () => {
  it('a First Call submission creates the case with its middle name', async () => {
    await deliverFirstCall(SUB.mnFirstCall, { '3': { first: 'MARGARET', middle: 'ADAEZE', last: 'OKONKWO' } });

    expect(casePostBodies[0].decedentMiddleName).toBe('ADAEZE');
    // The stored full name is untouched — the middle name is separate.
    expect(casePostBodies[0].decedentName).toBe('MARGARET OKONKWO');
  });

  it('an Arrangement-first submission does too, with no First Call', async () => {
    await deliverArrangement(SUB.mnArrangement, { '87': { first: 'JOYCE', middle: 'BEVERLY', last: 'GOLLIS' } });

    expect(casePostBodies[0].decedentMiddleName).toBe('BEVERLY');
    expect(casePostBodies[0].decedentName).toBe('JOYCE GOLLIS');
  });

  it('a submission with no middle name omits the field rather than sending blank', async () => {
    // Omitted, never '' — an empty box must not be able to blank a value
    // another form supplied.
    await deliverFirstCall(SUB.mnAbsent, { '3': { first: 'MARGARET', middle: '', last: 'OKONKWO' } });

    expect(casePostBodies[0]).not.toHaveProperty('decedentMiddleName');
  });

  it('reads the middle name off the deceased question, not another person on the form', async () => {
    // The Arrangement form carries several full-name questions (spouse,
    // parents, informant). Only qid 87 is the deceased.
    await deliverArrangement(SUB.mnOtherPeople, {
      '87': { first: 'JOYCE', middle: 'BEVERLY', last: 'GOLLIS' },
      '122': { first: 'MARCIA', middle: 'ELAINE', last: 'SHALLOW' },
    });

    expect(casePostBodies[0].decedentMiddleName).toBe('BEVERLY');
  });
});

describe('Arrangement Forms can open a case on its own (2026-10)', () => {
  it('SCENARIO B — an Arrangement submission with no First Call creates a case', async () => {
    // The reported bug: staff take a call overnight, submit the
    // Arrangement form, and the First Call Sheet is not entered until
    // morning. The missing First Call must not block the case.
    const response = await deliverArrangement(SUB.arrCreates);

    expect(response.status).toBe(200);
    expect(casePostBodies).toHaveLength(1);

    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrCreates);
    expect(stored!.createdCaseId).toBeTruthy();
    expect(stored!.status).not.toBe('unmatched');
  });

  it('derives Next of Kin from the Informant block, which is what makes creation possible', async () => {
    await deliverArrangement(SUB.arrCreates);
    const body = casePostBodies[0];

    expect(body.decedentName).toBe('MARGARET OKONKWO');
    // qid 276 = "Yes" authorizes the Informant (122/224) as the NOK.
    expect(body.nextOfKinName).toBe('DANIEL OKONKWO');
    expect(body.nextOfKinPhone).toBe('(555) 330-1180');
    expect(body.dateOfBirth).toBe('03/14/1951');
    expect(body.dateOfDeath).toBe('10/09/2026');
  });

  it('never allocates its own case number — it goes through POST /api/cases like every other path', async () => {
    await deliverArrangement(SUB.arrCreates);
    expect(casePostBodies[0]).not.toHaveProperty('caseNumber');
    expect(casePostBodies[0].organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('gives the new case a CaseFormLink, so the checklist reflects the form that created it', async () => {
    const before = caseFormLinkFixtures.length;
    await deliverArrangement(SUB.arrCreates);

    const added = caseFormLinkFixtures.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe('received');
    expect(added[0].formConfigId).toBe(ARRANGEMENT_FORMS_FORM_CONFIG_ID);
    expect(added[0].submissionId).toBeTruthy();
  });

  /**
   * Arrangement-first PDF import (2026-10). The webhook called
   * `preservePdfForSubmission` only in its existing-case branch, which a
   * case created from this very submission never reaches — so an
   * Arrangement-first case never had its PDF imported and its submission
   * sat at `pdfStatus: 'pending'` with no failure recorded, because the
   * import was never attempted. B2026-038 is exactly that state.
   */
  it('imports the Arrangement PDF for a case it just created — no First Call needed', async () => {
    const { fetchSubmissionPdf } = await import('@/lib/jotform/jotformClient');
    vi.mocked(fetchSubmissionPdf).mockClear();

    await deliverArrangement(SUB.arrCreates);

    expect(fetchSubmissionPdf).toHaveBeenCalledWith(ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, SUB.arrCreates);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrCreates);
    expect(submission?.pdfStatus).toBe('stored');
    expect(submission?.documentId).toBeTruthy();
  });

  it('files the PDF against the case it created, under the Arrangement document type', async () => {
    const { upload } = await import('@/services/documentService');
    vi.mocked(upload).mockClear();

    await deliverArrangement(SUB.arrCreates);

    expect(upload).toHaveBeenCalledTimes(1);
    const [params] = vi.mocked(upload).mock.calls[0];
    const createdCaseId = caseFormLinkFixtures[caseFormLinkFixtures.length - 1].caseId;
    expect(params.caseId).toBe(createdCaseId);
    expect(params.fileName).toBe('Arrangement Forms.pdf');
    expect(params.documentTypeKey).toBe('external_form.arrangement_forms');
    expect(params.mimeType).toBe('application/pdf');
  });

  it('a redelivered submission does not import the PDF twice', async () => {
    const { upload } = await import('@/services/documentService');
    vi.mocked(upload).mockClear();

    await deliverArrangement(SUB.arrCreates);
    await deliverArrangement(SUB.arrCreates);

    // The second delivery short-circuits on pdfStatus === 'stored'.
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('a PDF failure still leaves the case created, and records why', async () => {
    const { fetchSubmissionPdf, JotformClientError } = await import('@/lib/jotform/jotformClient');
    vi.mocked(fetchSubmissionPdf).mockRejectedValueOnce(new JotformClientError('nope', 'http_error'));

    const response = await deliverArrangement(SUB.arrPdfFails);

    // The case still exists — a document problem must never cost the case.
    expect(await response.json()).toEqual({ received: true, caseCreated: true });
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrPdfFails);
    expect(submission?.pdfStatus).toBe('failed');
    // Never silently "pending" — a failure is recorded so it is visible
    // and retryable, which is precisely what B2026-038 lacked.
    expect(submission?.pdfFailureReason).toBeTruthy();
  });

  it('records the Arrangement form as the source, never the First Call Sheet', async () => {
    const before = activityEventFixtures.length;
    await deliverArrangement(SUB.arrCreates);

    const events = activityEventFixtures.slice(before);
    const descriptions = events.map((e) => e.description).join(' | ');
    expect(descriptions).toMatch(/Arrangement/i);
    expect(descriptions).not.toMatch(/First Call/i);
  });

  it('fails safely when qid 276 is absent — no NOK can be derived, so nothing is invented', async () => {
    // The derivation refuses to guess which block is authoritative, so
    // the required NOK fields are missing and the submission waits for a
    // human rather than producing a half-identified case.
    const response = await deliverArrangement(SUB.arrNoBranch, { '276': '' });

    expect(response.status).toBe(200);
    expect(casePostBodies).toHaveLength(0);
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrNoBranch);
    expect(stored!.status).toBe('unmatched');
  });

  it('a redelivery of the same Arrangement submission creates exactly one case', async () => {
    await deliverArrangement(SUB.arrConcurrentA);
    await deliverArrangement(SUB.arrConcurrentA);
    expect(casePostBodies).toHaveLength(1);
  });
});

describe('Duplicate guard — a second form describing a known case is reviewed, never merged', () => {
  it('SCENARIO C — a First Call arriving after an Arrangement case attaches to it rather than creating a duplicate', async () => {
    // Arrangement creates the case...
    await deliverArrangement(SUB.arrDupe);
    expect(casePostBodies).toHaveLength(1);

    // ...and the case now genuinely exists in SOLIS.
    caseFixtures.push({
      ...caseFixtures[0],
      id: 'case-from-arrangement',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-900',
      decedentName: 'MARGARET OKONKWO',
      dateOfBirth: '03/14/1951',
      dateOfDeath: '10/09/2026',
    });

    // The First Call for the same death arrives the next morning with no
    // link to it.
    const response = await deliverFirstCall(SUB.fcAfterArr, {
      '3': { first: 'MARGARET', last: 'OKONKWO' },
      '6': '03/14/1951',
      '8': '10/09/2026',
    });

    expect(response.status).toBe(200);
    // No second case. The First Call fills the case's empty First Call
    // slot (see 'Attaching to the case it belongs to' below).
    expect(casePostBodies).toHaveLength(1);
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.fcAfterArr);
    expect(stored!.status).toBe('matched');
    expect(stored!.createdCaseId).toBeNull();
    const link = caseFormLinkFixtures.find((l) => l.id === stored!.caseFormLinkId);
    expect(link!.caseId).toBe('case-from-arrangement');
    expect(link!.formConfigId).toBe(FIRST_CALL_SHEET_FORM_CONFIG_ID);
  });

  it('records why it was held, naming the candidate case for staff review', async () => {
    caseFixtures.push({
      ...caseFixtures[0],
      id: 'case-dupe-target',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-901',
      decedentName: 'MARGARET OKONKWO',
      dateOfBirth: '03/14/1951',
      dateOfDeath: '10/09/2026',
    });
    const before = activityEventFixtures.length;
    await deliverArrangement(SUB.arrDupe);

    const event = activityEventFixtures
      .slice(before)
      .find((e) => e.eventType === 'external_form.duplicate_suspected');
    expect(event).toBeDefined();
    expect(event!.description).toMatch(/B2026-901/);
    expect(event!.description).toMatch(/No case was created and nothing was merged/);
    // Not attached to a candidate case — no association has been made.
    expect(event!.caseId).toBeNull();
  });

  it('a shared name alone never blocks creation', async () => {
    // Same name, different death. This must still create a case, or a
    // real death would go unrecorded.
    caseFixtures.push({
      ...caseFixtures[0],
      id: 'case-same-name-only',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-902',
      decedentName: 'MARGARET OKONKWO',
      dateOfBirth: '01/01/1940',
      dateOfDeath: '01/01/2020',
    });
    await deliverArrangement(SUB.arrCreates);
    expect(casePostBodies).toHaveLength(1);
  });

  it('a candidate in ANOTHER organization never blocks creation', async () => {
    caseFixtures.push({
      ...caseFixtures[0],
      id: 'case-other-org',
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
      caseNumber: 'X-1',
      decedentName: 'MARGARET OKONKWO',
      dateOfBirth: '03/14/1951',
      dateOfDeath: '10/09/2026',
    });
    await deliverArrangement(SUB.arrCreates);
    expect(casePostBodies).toHaveLength(1);
  });
});

/**
 * Attaching to the case it belongs to (2026-10). The everyday Manors
 * order: the First Call creates the case, then the Arrangement is filled
 * in directly on Jotform with no SOLIS link. It must land on that case
 * without anyone importing it (B2026-039/-040/-041 all needed a manual
 * import). See domain/externalForms/existingCaseAttachment.ts.
 */
describe('Attaching to the case it belongs to — an Arrangement after its First Call', () => {
  const FIRST_CALL_CASE_ID = 'case-from-first-call';

  function givenFirstCallCase(overrides: Partial<(typeof caseFixtures)[number]> = {}) {
    caseFixtures.push({
      ...caseFixtures[0],
      id: FIRST_CALL_CASE_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-941',
      decedentName: 'MARGARET OKONKWO',
      dateOfBirth: '03/14/1951',
      dateOfDeath: '10/09/2026',
      isDeleted: false,
      ...overrides,
    });
  }

  function givenFilledSlot(formConfigId: string) {
    const now = new Date().toISOString();
    caseFormLinkFixtures.push({
      id: `link-${FIRST_CALL_CASE_ID}-${formConfigId}`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: FIRST_CALL_CASE_ID,
      provider: 'jotform',
      formConfigId,
      linkTokenHash: 'hash',
      status: 'received',
      sentAt: null,
      submissionId: 'an-earlier-submission',
      createdAt: now,
      updatedAt: now,
    });
  }

  const stored = () => externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrDupe)!;

  it('attaches the Arrangement to the First Call case and imports its PDF there — no new case, no manual import', async () => {
    givenFirstCallCase();
    givenFilledSlot(FIRST_CALL_SHEET_FORM_CONFIG_ID);
    const { upload } = await import('@/services/documentService');

    const response = await deliverArrangement(SUB.arrDupe);

    expect(await response.json()).toEqual({ received: true, caseCreated: false, attachedToCaseId: FIRST_CALL_CASE_ID });
    expect(casePostBodies).toHaveLength(0);
    expect(stored().status).toBe('matched');
    expect(stored().caseCreationFailureReason ?? null).toBeNull();
    const link = caseFormLinkFixtures.find((l) => l.id === stored().caseFormLinkId)!;
    expect(link).toMatchObject({ caseId: FIRST_CALL_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, status: 'received' });
    expect(stored().pdfStatus).toBe('stored');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upload).mock.calls[0][0]).toMatchObject({ caseId: FIRST_CALL_CASE_ID, fileName: 'Arrangement Forms.pdf' });
  });

  it('records that it was attached automatically, on the case', async () => {
    givenFirstCallCase();
    const before = activityEventFixtures.length;
    await deliverArrangement(SUB.arrDupe);

    const event = activityEventFixtures.slice(before).find((e) => e.eventType === 'external_form.submission_linked');
    expect(event).toMatchObject({ caseId: FIRST_CALL_CASE_ID, severity: 'info' });
    expect(event!.description).toMatch(/automatically attached/);
  });

  it('still attaches when only the date of birth disagrees, and flags it for staff', async () => {
    // B2026-041: the two forms differ only in the birth year.
    givenFirstCallCase({ dateOfBirth: '03/14/2044' });
    const before = activityEventFixtures.length;
    await deliverArrangement(SUB.arrDupe);

    expect(stored().status).toBe('matched');
    const event = activityEventFixtures.slice(before).find((e) => e.eventType === 'external_form.submission_linked');
    expect(event!.severity).toBe('warning');
    expect(event!.description).toMatch(/date of birth differs/);
    // The case keeps its own date of birth until staff choose otherwise.
    expect(caseFixtures.find((c) => c.id === FIRST_CALL_CASE_ID)!.dateOfBirth).toBe('03/14/2044');
    expect(stored().status).not.toBe('reviewed');
  });

  it('never copies the form answers onto the case — they still go through review', async () => {
    givenFirstCallCase({ nextOfKinName: 'SOMEONE ELSE' } as never);
    await deliverArrangement(SUB.arrDupe);
    const theCase = caseFixtures.find((c) => c.id === FIRST_CALL_CASE_ID)!;
    expect((theCase as unknown as { nextOfKinName: string }).nextOfKinName).toBe('SOMEONE ELSE');
  });

  it('a redelivery attaches nothing twice and uploads no second PDF', async () => {
    givenFirstCallCase();
    const { upload } = await import('@/services/documentService');
    await deliverArrangement(SUB.arrDupe);
    const linksAfterFirst = caseFormLinkFixtures.length;
    await deliverArrangement(SUB.arrDupe);
    expect(caseFormLinkFixtures.length).toBe(linksAfterFirst);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('is held for staff when the case already has an Arrangement — it never displaces one', async () => {
    givenFirstCallCase();
    givenFilledSlot(ARRANGEMENT_FORMS_FORM_CONFIG_ID);
    const { upload } = await import('@/services/documentService');
    await deliverArrangement(SUB.arrDupe);

    expect(stored().status).toBe('unmatched');
    expect(stored().caseCreationFailureReason).toBe('duplicate_review_required');
    expect(upload).not.toHaveBeenCalled();
    const slot = caseFormLinkFixtures.find((l) => l.id === `link-${FIRST_CALL_CASE_ID}-${ARRANGEMENT_FORMS_FORM_CONFIG_ID}`);
    expect(slot!.submissionId).toBe('an-earlier-submission');
  });

  it('is held for staff when two cases match', async () => {
    givenFirstCallCase();
    caseFixtures.push({ ...caseFixtures[caseFixtures.length - 1], id: 'case-second-match', caseNumber: 'B2026-942' });
    await deliverArrangement(SUB.arrDupe);
    expect(stored().status).toBe('unmatched');
  });

  it('is held for staff when the matching case is archived', async () => {
    givenFirstCallCase({ isDeleted: true });
    await deliverArrangement(SUB.arrDupe);
    expect(stored().status).toBe('unmatched');
  });

  it('is held for staff when only the name and date of birth agree — the date of death must match', async () => {
    givenFirstCallCase({ dateOfDeath: '10/01/2026' });
    await deliverArrangement(SUB.arrDupe);
    expect(stored().status).toBe('unmatched');
    expect(casePostBodies).toHaveLength(0);
  });

  it('never attaches to a matching case in another organization', async () => {
    givenFirstCallCase({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    await deliverArrangement(SUB.arrDupe);
    // No candidate in this organization, so it opens its own case.
    expect(casePostBodies).toHaveLength(1);
    expect(caseFormLinkFixtures.some((l) => l.caseId === FIRST_CALL_CASE_ID)).toBe(false);
  });
});

describe('Only a case_create form may create a case', () => {
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

describe('Automatic intake failure visibility (2026-10)', () => {
  it('records WHY creation did not happen on the submission itself', async () => {
    // Without this the reason lived only in a server log, so Unmatched
    // Forms showed an unexplained row and staff had no way to find out.
    await deliverArrangement(SUB.arrNoBranch, { '276': '' });

    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrNoBranch);
    expect(stored!.status).toBe('unmatched');
    expect(stored!.caseCreationFailureReason).toMatch(/^missing_required_fields:/);
    expect(stored!.caseCreationFailureReason).toContain('nextOfKinName');
  });

  it('records a held-back duplicate as the reason, not a generic failure', async () => {
    // Two matching cases: too ambiguous to attach, so it is held.
    for (const id of ['case-reason-dupe', 'case-reason-dupe-2']) {
      caseFixtures.push({
        ...caseFixtures[0],
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseNumber: id === 'case-reason-dupe' ? 'B2026-903' : 'B2026-904',
        decedentName: 'MARGARET OKONKWO',
        dateOfBirth: '03/14/1951',
        dateOfDeath: '10/09/2026',
      });
    }
    await deliverArrangement(SUB.arrDupe);

    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrDupe);
    expect(stored!.caseCreationFailureReason).toBe('duplicate_review_required');
  });

  it('leaves no failure reason when creation succeeds', async () => {
    await deliverArrangement(SUB.arrCreates);
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.arrCreates);
    expect(stored!.createdCaseId).toBeTruthy();
    expect(stored!.caseCreationFailureReason).toBeNull();
  });
});

describe('Arrangement field mapping — time of death and certifier (2026-10)', () => {
  /** Joyce Gollis's real production submission shape, qid for qid. */
  function fullArrangement(overrides: Record<string, string | Record<string, string>> = {}) {
    return arrangementAnswers({
      // qid 91: the 24-hour control immediately after Date of Death.
      '91': { timeInput: '13:30', hourSelect: '13', minuteSelect: '30' },
      '138': 'JOHN ZARAVINOS',
      '139': '954-486-4085',
      '137': 'ME129731',
      '140': '954-777-2262',
      ...overrides,
    });
  }

  async function deliverFull(id: string, overrides: Record<string, string | Record<string, string>> = {}) {
    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      submissionId: id,
      answers: fullArrangement(overrides),
      timeFormats: { '91': '24 Hour' },
    });
    const { POST } = await import('./route');
    return POST(webhookRequest({ formID: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, submissionID: id }));
  }

  it('carries time of death from qid 91 into the new case', async () => {
    await deliverFull('2000000000000000020');
    expect(casePostBodies[0].timeOfDeath).toBe('13:30');
  });

  it('carries the full certifier block into the new case', async () => {
    await deliverFull('2000000000000000021');
    const body = casePostBodies[0];
    expect(body.certifierName).toBe('JOHN ZARAVINOS');
    expect(body.certifierPhone).toBe('954-486-4085');
    expect(body.certifierLicenseNumber).toBe('ME129731');
    expect(body.certifierFax).toBe('954-777-2262');
  });

  it('omits what the submission did not carry, rather than sending blanks', async () => {
    // A form left partly blank must not blank the case's own fields.
    await deliverFull('2000000000000000022', { '138': '', '139': '', '137': '', '140': '', '91': '' });
    const body = casePostBodies[0];
    expect(body).not.toHaveProperty('certifierName');
    expect(body).not.toHaveProperty('certifierPhone');
    expect(body).not.toHaveProperty('timeOfDeath');
  });

  it('never invents a weight — this form has no weight question', async () => {
    // Confirmed against the live form's own metadata: the only numeric
    // field is qid 273 "Age-Value". Weight reaches a case from the First
    // Call Sheet or from staff entering it.
    await deliverFull('2000000000000000023');
    expect(casePostBodies[0]).not.toHaveProperty('weight');
  });
});
