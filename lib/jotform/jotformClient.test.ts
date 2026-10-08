import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSubmissionPdf, fetchSubmissionAnswers, JotformClientError } from './jotformClient';

const FORM_ID = '261945978664175';
const SUBMISSION_ID = 'synthetic-submission-id';
const REAL_PDF_HEADER = Buffer.from('%PDF-1.4\n%synthetic-fixture-not-a-real-submission\n');

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.JOTFORM_API_KEY;
});

describe('fetchSubmissionPdf — endpoint construction and authentication', () => {
  it('calls the verified pdf-converter/fill-pdf endpoint with the APIKEY header, never the key in the URL', async () => {
    process.env.JOTFORM_API_KEY = 'test-key-never-logged';
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;
    stubFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      return new Response(REAL_PDF_HEADER, { status: 200, headers: { 'content-type': 'application/pdf' } });
    });

    await fetchSubmissionPdf(FORM_ID, SUBMISSION_ID);

    expect(capturedUrl).toBe(`https://api.jotform.com/pdf-converter/${FORM_ID}/fill-pdf?download=1&submissionID=${SUBMISSION_ID}`);
    expect(capturedUrl).not.toContain('test-key-never-logged');
    expect((capturedHeaders as Record<string, string>).APIKEY).toBe('test-key-never-logged');
  });

  it('preserves a control_time question\'s timeFormat, and adds no other sibling field', async () => {
    // Live-intake fix (2026-10): a compound `control_time` answer cannot
    // be interpreted without the question's own timeFormat — Jotform emits
    // a vestigial `ampm` even on a 24-hour question. See
    // domain/externalForms/extractMappedFields.ts#combineTimeParts.
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            content: {
              form_id: FORM_ID,
              created_at: '2026-10-08 16:49:22',
              answers: {
                '9': {
                  name: 'timeof',
                  type: 'control_time',
                  timeFormat: '24 Hour',
                  prettyFormat: '11:30 PM',
                  text: 'Time of Death:',
                  answer: { timeInput: '11:30', hourSelect: '11', minuteSelect: '30', ampm: 'PM' },
                },
                '7': { name: 'weight', timeFormat: 'should not matter', answer: '136' },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const result = await fetchSubmissionAnswers(SUBMISSION_ID);
    expect(result.answers['9']).toEqual({
      answer: { timeInput: '11:30', hourSelect: '11', minuteSelect: '30', ampm: 'PM' },
      timeFormat: '24 Hour',
    });
    // Nothing else leaks through — notably not Jotform's own prettyFormat,
    // which said "11:30 PM" for a 24-hour question.
    expect(Object.keys(result.answers['9']).sort()).toEqual(['answer', 'timeFormat']);
  });

  it('omits timeFormat entirely when Jotform does not report one', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            content: { form_id: FORM_ID, created_at: '2026-08-01 12:00:00', answers: { '7': { answer: '136' } } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const result = await fetchSubmissionAnswers(SUBMISSION_ID);
    expect(result.answers['7']).toEqual({ answer: '136' });
    expect('timeFormat' in result.answers['7']).toBe(false);
  });

  it('throws missing_api_key when JOTFORM_API_KEY is not configured', async () => {
    stubFetch(async () => new Response(REAL_PDF_HEADER, { status: 200, headers: { 'content-type': 'application/pdf' } }));
    await expect(fetchSubmissionPdf(FORM_ID, SUBMISSION_ID)).rejects.toMatchObject({ category: 'missing_api_key' });
  });
});

describe('fetchSubmissionPdf — response validation', () => {
  it('accepts a valid PDF response', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => new Response(REAL_PDF_HEADER, { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const buffer = await fetchSubmissionPdf(FORM_ID, SUBMISSION_ID);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('rejects a non-2xx HTTP status', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => new Response('not found', { status: 404 }));
    await expect(fetchSubmissionPdf(FORM_ID, SUBMISSION_ID)).rejects.toMatchObject({ category: 'http_error' });
  });

  it('rejects a non-PDF content type', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => new Response('{"message":"success"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(fetchSubmissionPdf(FORM_ID, SUBMISSION_ID)).rejects.toMatchObject({ category: 'invalid_content_type' });
  });

  it('rejects a response missing the %PDF magic bytes even if labeled application/pdf', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => new Response('not actually a pdf', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    await expect(fetchSubmissionPdf(FORM_ID, SUBMISSION_ID)).rejects.toMatchObject({ category: 'invalid_pdf' });
  });

  it('rejects an empty response', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    await expect(fetchSubmissionPdf(FORM_ID, SUBMISSION_ID)).rejects.toMatchObject({ category: 'empty_response' });
  });

  it('rejects a response exceeding the 15MB limit', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    const oversized = Buffer.concat([REAL_PDF_HEADER, Buffer.alloc(16 * 1024 * 1024)]);
    stubFetch(async () => new Response(oversized, { status: 200, headers: { 'content-type': 'application/pdf' } }));
    await expect(fetchSubmissionPdf(FORM_ID, SUBMISSION_ID)).rejects.toMatchObject({ category: 'oversized' });
  });

  it('wraps a network failure as network_error, never leaking the raw error', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => {
      throw new Error('ECONNRESET at socket internals with sensitive stack trace');
    });
    try {
      await fetchSubmissionPdf(FORM_ID, SUBMISSION_ID);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JotformClientError);
      expect((error as JotformClientError).category).toBe('network_error');
      expect((error as JotformClientError).message).not.toContain('ECONNRESET');
    }
  });
});

describe('fetchSubmissionAnswers — historical-submission ingestion (2026-09)', () => {
  it('calls the Submission API endpoint with the APIKEY header, never the key in the URL', async () => {
    process.env.JOTFORM_API_KEY = 'test-key-never-logged';
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;
    stubFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({ content: { form_id: FORM_ID, created_at: '2026-08-01 12:00:00', answers: {} } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    await fetchSubmissionAnswers(SUBMISSION_ID);

    expect(capturedUrl).toBe(`https://api.jotform.com/submission/${SUBMISSION_ID}`);
    expect(capturedUrl).not.toContain('test-key-never-logged');
    expect((capturedHeaders as Record<string, string>).APIKEY).toBe('test-key-never-logged');
  });

  it('extracts formId, submittedAt, and qid-keyed answers, and nothing else', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            content: {
              form_id: FORM_ID,
              created_at: '2026-08-01 12:00:00',
              answers: {
                '174': { name: 'nameof', answer: { first: 'Mary', last: 'Smith' } },
                '175': { name: 'releaseRelationship', answer: 'Daughter' },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const result = await fetchSubmissionAnswers(SUBMISSION_ID);
    expect(result.formId).toBe(FORM_ID);
    expect(result.submittedAt).toBe('2026-08-01 12:00:00');
    expect(result.answers['174']).toEqual({ answer: { first: 'Mary', last: 'Smith' } });
    expect(result.answers['175']).toEqual({ answer: 'Daughter' });
  });

  it('throws missing_api_key when JOTFORM_API_KEY is not configured', async () => {
    stubFetch(async () => new Response('{}', { status: 200 }));
    await expect(fetchSubmissionAnswers(SUBMISSION_ID)).rejects.toMatchObject({ category: 'missing_api_key' });
  });

  it('rejects a non-2xx HTTP status', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => new Response('not found', { status: 404 }));
    await expect(fetchSubmissionAnswers(SUBMISSION_ID)).rejects.toMatchObject({ category: 'http_error' });
  });

  it('rejects a non-JSON response', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => new Response('not json', { status: 200 }));
    await expect(fetchSubmissionAnswers(SUBMISSION_ID)).rejects.toMatchObject({ category: 'invalid_content_type' });
  });

  it('rejects a response missing form_id/answers', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => new Response(JSON.stringify({ content: {} }), { status: 200 }));
    await expect(fetchSubmissionAnswers(SUBMISSION_ID)).rejects.toMatchObject({ category: 'invalid_submission_response' });
  });

  it('wraps a network failure as network_error, never leaking the raw error', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(async () => {
      throw new Error('ECONNRESET at socket internals with sensitive stack trace');
    });
    try {
      await fetchSubmissionAnswers(SUBMISSION_ID);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JotformClientError);
      expect((error as JotformClientError).category).toBe('network_error');
      expect((error as JotformClientError).message).not.toContain('ECONNRESET');
    }
  });

  it('never includes the raw response body in its own return shape beyond formId/submittedAt/answers', async () => {
    process.env.JOTFORM_API_KEY = 'k';
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            content: {
              form_id: FORM_ID,
              created_at: '2026-08-01 12:00:00',
              answers: { '7': { answer: 'synthetic-ssn-000-00-0000' } },
              some_other_sensitive_field: 'should never leak through',
            },
          }),
          { status: 200 },
        ),
    );
    const result = await fetchSubmissionAnswers(SUBMISSION_ID);
    expect(Object.keys(result)).toEqual(['formId', 'submittedAt', 'answers']);
    expect(JSON.stringify(result)).not.toContain('should never leak through');
  });
});
