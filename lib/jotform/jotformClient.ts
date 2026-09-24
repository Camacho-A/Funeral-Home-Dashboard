/**
 * Manors Jotform integration (case-first architecture, 2026-09). The one
 * place this codebase ever calls the Jotform API — server-only,
 * `JOTFORM_API_KEY` read directly from `process.env` (mirrors
 * lib/email/resendClient.ts's/services/notifications/smsChannel.ts's own
 * "no lib/env.ts wrapper, no dev fallback — a missing third-party secret
 * fails clearly, not silently" posture for external provider secrets).
 *
 * Verified endpoint (empirically confirmed against a real Manors
 * Arrangement Forms submission, structurally distinguished from
 * Jotform's generic `generatePDF` export by producer/creator/page-count
 * — see this integration's own audit report): `GET
 * https://api.jotform.com/pdf-converter/{formId}/fill-pdf?download=1&submissionID={submissionId}`,
 * authenticated via the `APIKEY` header — never the API key in a URL,
 * never logged.
 */

import type { JotformAnswerMap } from '@/domain/externalForms/extractMappedFields';

const JOTFORM_API_BASE = 'https://api.jotform.com';
const MAX_PDF_BYTES = 15 * 1024 * 1024; // matches the existing documentService upload limit

export class JotformClientError extends Error {
  constructor(
    message: string,
    public readonly category:
      | 'missing_api_key'
      | 'http_error'
      | 'invalid_content_type'
      | 'invalid_pdf'
      | 'oversized'
      | 'empty_response'
      | 'network_error'
      | 'invalid_submission_response',
  ) {
    super(message);
    this.name = 'JotformClientError';
  }
}

function getJotformApiKey(): string {
  const key = process.env.JOTFORM_API_KEY;
  if (!key) {
    throw new JotformClientError('JOTFORM_API_KEY is not configured.', 'missing_api_key');
  }
  return key;
}

function hasPdfMagicBytes(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
}

/**
 * Retrieves the populated original Smart PDF Form for one submission.
 * Never logs the response body, never returns the API key to the
 * caller, never includes it in the constructed URL's query string (it
 * travels only in the `APIKEY` header). Throws a `JotformClientError`
 * with a `category` a caller can safely record (see
 * services/externalFormPdfService.ts) — never the raw underlying error
 * message, which could echo request details.
 */
export async function fetchSubmissionPdf(formId: string, submissionId: string): Promise<Buffer> {
  const apiKey = getJotformApiKey();
  const url = `${JOTFORM_API_BASE}/pdf-converter/${encodeURIComponent(formId)}/fill-pdf?download=1&submissionID=${encodeURIComponent(submissionId)}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { APIKEY: apiKey } });
  } catch {
    throw new JotformClientError('Network error contacting Jotform.', 'network_error');
  }

  if (!response.ok) {
    throw new JotformClientError(`Jotform PDF retrieval failed with status ${response.status}.`, 'http_error');
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/pdf')) {
    throw new JotformClientError('Jotform did not return a PDF response.', 'invalid_content_type');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new JotformClientError('Jotform returned an empty response.', 'empty_response');
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new JotformClientError(`PDF exceeds the ${MAX_PDF_BYTES / (1024 * 1024)}MB limit.`, 'oversized');
  }
  if (!hasPdfMagicBytes(buffer)) {
    throw new JotformClientError('Response does not have valid PDF magic bytes.', 'invalid_pdf');
  }

  return buffer;
}

export type JotformSubmissionAnswers = {
  formId: string;
  submittedAt: string | null;
  answers: JotformAnswerMap;
};

/**
 * Historical-submission ingestion (2026-09). Retrieves one submission's
 * own form id, submitted-at timestamp, and qid-keyed answers directly
 * from Jotform's Submission API (`GET /submission/{id}`) — used only by
 * the historical-import path (`app/api/cases/[caseId]/forms/[formConfigId]/
 * import-submission/route.ts`); the webhook never calls this, since it
 * already receives its own answers directly in the POST body.
 *
 * `answers`' shape matches the same `/submission/{id}` response shape
 * `domain/externalForms/extractMappedFields.ts`'s own `JotformAnswerMap`
 * doc comment already documents as confirmed (qid-keyed, a plain string
 * or a sub-keyed object per compound field) — not re-derived here.
 *
 * Never logs or returns the raw response body — only these three
 * extracted fields ever leave this function. `submittedAt` and `formId`
 * are safe, non-PII metadata (used only for the import-confirmation UI's
 * "does this match the expected form" check); no answer value is ever
 * exposed by this function's own return shape beyond what the caller
 * passes into `extractMappedFields` (the exact same trusted, minimizing
 * mapping used by the webhook).
 */
export async function fetchSubmissionAnswers(submissionId: string): Promise<JotformSubmissionAnswers> {
  const apiKey = getJotformApiKey();
  const url = `${JOTFORM_API_BASE}/submission/${encodeURIComponent(submissionId)}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { APIKEY: apiKey } });
  } catch {
    throw new JotformClientError('Network error contacting Jotform.', 'network_error');
  }

  if (!response.ok) {
    throw new JotformClientError(`Jotform submission retrieval failed with status ${response.status}.`, 'http_error');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new JotformClientError('Jotform did not return a valid JSON response.', 'invalid_content_type');
  }

  const content = body && typeof body === 'object' ? (body as Record<string, unknown>).content : undefined;
  const formId = content && typeof content === 'object' ? (content as Record<string, unknown>).form_id : undefined;
  const rawAnswers = content && typeof content === 'object' ? (content as Record<string, unknown>).answers : undefined;
  const createdAt = content && typeof content === 'object' ? (content as Record<string, unknown>).created_at : undefined;

  if (typeof formId !== 'string' || !rawAnswers || typeof rawAnswers !== 'object') {
    throw new JotformClientError('Jotform submission response missing expected fields.', 'invalid_submission_response');
  }

  const answers: JotformAnswerMap = {};
  for (const [qid, entry] of Object.entries(rawAnswers as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || !('answer' in (entry as Record<string, unknown>))) continue;
    const value = (entry as Record<string, unknown>).answer;
    if (typeof value === 'string' || (value && typeof value === 'object')) {
      answers[qid] = { answer: value as string | Record<string, string> };
    }
  }

  return { formId, submittedAt: typeof createdAt === 'string' ? createdAt : null, answers };
}
