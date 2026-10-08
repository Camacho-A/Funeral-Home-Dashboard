import { fetchSubmissionAnswers, JotformClientError } from './jotformClient';
import type { JotformAnswerMap } from '@/domain/externalForms/extractMappedFields';

/**
 * Server-side Jotform webhook authentication (2026-10). Establishes that
 * an inbound webhook delivery corresponds to a REAL submission on a REAL
 * form owned by this account — and returns that submission's authoritative
 * answers, so nothing in the request body is ever trusted as data.
 *
 * WHY THE PREVIOUS MECHANISM WAS NOT AUTHENTICATION
 *
 * This route used to authenticate deliveries with a shared secret carried
 * in a Jotform *hidden field* (`solisWebhookAuth`). A hidden field is only
 * hidden from the rendering — its default value ships inside the public
 * form's own HTML/JSON, so anyone who can open the form can read the
 * secret and then POST a fully forged body to this public endpoint. It
 * authenticated nothing. It is retired; see `app/api/webhooks/jotform/route.ts`.
 *
 * WHAT JOTFORM ACTUALLY SUPPORTS (verified, not assumed)
 *
 * Jotform does not sign its webhooks. Per Jotform Support: "we do not
 * currently offer any security or authentication mechanisms for webhooks"
 * (https://www.jotform.com/answers/14043811-authentication-in-webhooks).
 * There is no signature header, no HMAC, no timestamp header, and no
 * shared-secret header to verify — so this module invents none. Jotform's
 * only published suggestion is a secret in the webhook URL's query string,
 * which is rejected here: a URL secret is recorded in platform access logs
 * and request traces, which would replace one exposed secret with another.
 *
 * THE MECHANISM USED INSTEAD
 *
 * The delivery is treated as an untrusted *notification* that carries two
 * claims and nothing more: a form id and a submission id. Those two claims
 * are then checked against Jotform itself over an authenticated API call
 * keyed by the server-only `JOTFORM_API_KEY`:
 *
 *   1. `GET /submission/{id}` with the `APIKEY` header. The key is never
 *      placed in a URL, logged, or returned.
 *   2. Jotform returns a submission ONLY if this account owns it —
 *      empirically confirmed: an unknown or foreign submission id answers
 *      **401 "You're not authorized to use (/submission-id)"**, not 404.
 *      So reachability through our own key is itself proof of provenance;
 *      a submission from anyone else's form is simply unobtainable.
 *   3. The submission's own `form_id`, as reported by Jotform, must equal
 *      the claimed form id. A real submission id belonging to form A can
 *      therefore never be presented as a submission to form B.
 *   4. The answers returned by the API — never the POST body's
 *      `rawRequest` — are what the caller maps into a case.
 *
 * Consequently a forged body cannot inject case data: an attacker who
 * fabricates answers gets them discarded, and an attacker who omits a
 * genuine submission id gets rejected at step 2.
 *
 * THE RESIDUAL RISK, AND THE SUPPLEMENTARY CONTROL
 *
 * Step 2 proves a submission is genuine, but a submission id is not a
 * secret — so on its own it must not be treated as authorization (if one
 * were guessed or recalled, a genuine submission could be pushed through
 * early or out of band). Two further controls bound that:
 *
 *   - Idempotency, which already existed: the submission row's primary key
 *     is deterministic, and case creation sits behind a compare-and-swap
 *     claim, so a replayed id can never produce a second case.
 *   - `MAX_SUBMISSION_AGE_MS` below — a historical-replay bound, so an
 *     attacker cannot walk backwards through this account's submission
 *     history and force bulk ingestion of old submissions.
 *
 * WHY THAT BOUND IS HOURS AND NOT MINUTES — a real limitation, stated
 * plainly rather than papered over. Jotform's `created_at` is formatted
 * `YYYY-MM-DD HH:MM:SS` with **no timezone offset** (verified against the
 * live API), and is rendered in the Jotform account's configured
 * timezone, which this server does not know. Any window tighter than the
 * maximum possible timezone displacement (±14h) would therefore reject
 * legitimate deliveries rather than add security. The bound is set wide
 * enough to be correct under any account timezone, which is what makes it
 * a replay bound rather than a nonce window. It is a supplement to the
 * ownership proof in step 2, never the primary control.
 */

/** Digits only. Jotform form and submission ids are numeric strings
    (submission ids observed at 19 digits). Shape-checking before the API
    call keeps a junk claim from becoming an outbound request at all. */
const NUMERIC_ID_PATTERN = /^\d{6,32}$/;

/**
 * 36 hours: covers the ±14h maximum timezone displacement of an
 * offset-less `created_at`, plus operational slack for Jotform's own
 * webhook retry schedule and clock skew. See the module doc comment for
 * why this cannot honestly be tightened to minutes.
 */
const MAX_SUBMISSION_AGE_MS = 36 * 60 * 60 * 1000;

/** Same displacement allowance in the other direction — an account
    timezone ahead of the server makes a fresh submission look future-dated. */
const MAX_SUBMISSION_FUTURE_SKEW_MS = 14 * 60 * 60 * 1000;

export type JotformSubmissionAuthenticity =
  | {
      authentic: true;
      /** Jotform's own answers for this submission — the only answer data
          a caller may act on. Never the webhook body's `rawRequest`. */
      answers: JotformAnswerMap;
      submittedAt: string | null;
    }
  | {
      authentic: false;
      /** Safe, non-sensitive discriminator for logs and responses. Never
          contains answer data, the API key, or any submission content. */
      reason:
        | 'malformed_identifiers'
        | 'submission_not_retrievable'
        | 'form_id_mismatch'
        | 'submission_too_old'
        | 'submission_timestamp_unusable'
        | 'provider_unavailable';
      /** What the webhook route should answer Jotform. 503 invites a
          retry (transient/misconfiguration); 401 is terminal. */
      status: 401 | 503;
    };

/** `YYYY-MM-DD HH:MM:SS`, no offset — parsed as UTC deliberately, since
    the real timezone is unknown and the bound above absorbs the
    displacement. Returns null if Jotform's value is not this shape. */
function parseJotformTimestampAsUtcMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Authenticates one webhook delivery against Jotform itself and returns
 * the authoritative answers to use. Fails closed: every failure path
 * returns `authentic: false`, and nothing here ever throws.
 *
 * `claimedFormId` must already have been resolved to a trusted, enabled
 * `ExternalFormConfig` by the caller — this function proves the claim is
 * real, it does not decide which organization a form belongs to.
 */
export async function authenticateJotformSubmission(params: {
  claimedFormId: string;
  claimedSubmissionId: string;
  now?: number;
}): Promise<JotformSubmissionAuthenticity> {
  const { claimedFormId, claimedSubmissionId } = params;
  const now = params.now ?? Date.now();

  if (!NUMERIC_ID_PATTERN.test(claimedFormId) || !NUMERIC_ID_PATTERN.test(claimedSubmissionId)) {
    return { authentic: false, reason: 'malformed_identifiers', status: 401 };
  }

  let retrieved;
  try {
    retrieved = await fetchSubmissionAnswers(claimedSubmissionId);
  } catch (error) {
    // A missing key or a network fault is OUR problem, not an inauthentic
    // delivery — answer 503 so Jotform retries rather than dropping a
    // genuine submission. Anything else (notably the 401 Jotform returns
    // for a submission this account does not own) is terminal.
    const category = error instanceof JotformClientError ? error.category : null;
    if (category === 'missing_api_key' || category === 'network_error') {
      console.error(
        `[jotform authenticity] Could not reach Jotform to verify submission ${claimedSubmissionId} (${category}) — delivery not accepted.`,
      );
      return { authentic: false, reason: 'provider_unavailable', status: 503 };
    }
    return { authentic: false, reason: 'submission_not_retrievable', status: 401 };
  }

  // Jotform's own answer to "which form is this submission on" — the
  // claim in the request body has no authority here.
  if (retrieved.formId !== claimedFormId) {
    console.error(
      `[jotform authenticity] Submission ${claimedSubmissionId} belongs to form ${retrieved.formId} but was delivered as form ${claimedFormId} — rejected.`,
    );
    return { authentic: false, reason: 'form_id_mismatch', status: 401 };
  }

  if (!retrieved.submittedAt) {
    return { authentic: false, reason: 'submission_timestamp_unusable', status: 401 };
  }
  const submittedAtMs = parseJotformTimestampAsUtcMs(retrieved.submittedAt);
  if (submittedAtMs === null) {
    return { authentic: false, reason: 'submission_timestamp_unusable', status: 401 };
  }
  if (now - submittedAtMs > MAX_SUBMISSION_AGE_MS || submittedAtMs - now > MAX_SUBMISSION_FUTURE_SKEW_MS) {
    return { authentic: false, reason: 'submission_too_old', status: 401 };
  }

  return { authentic: true, answers: retrieved.answers, submittedAt: retrieved.submittedAt };
}
