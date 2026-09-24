/**
 * Manors Jotform integration (case-first architecture, 2026-09). Parses a
 * Jotform webhook delivery's form-encoded body into the shapes the rest
 * of this integration needs. Jotform's documented webhook POST carries
 * `formID`, `submissionID`, and `rawRequest` (a JSON-stringified blob of
 * every answer, including hidden fields) — confirmed from documentation,
 * but NOT independently verified against a real live delivery (no
 * webhook has been configured/exercised yet, by design). `rawRequest`'s
 * own key convention (`q{qid}_{name}` for a simple field,
 * `q{qid}_{name}[{subfield}]` for a compound one) mirrors the URL-prefill
 * convention this integration already verified — this is the
 * best-grounded assumption available without a real payload to inspect.
 *
 * Jotform hidden-field identifier correction (2026-09): a live audit of
 * both real Manors Jotforms found that a hidden field's internal `name`
 * is NOT reliably derived from its requested display name (confirmed:
 * lowercased on some fields, an unrelated auto-generated placeholder
 * like `input274` on others). Every hidden-field lookup in this module is
 * therefore qid-driven — the qid comes from the caller's own trusted,
 * server-side `ExternalFormConfig` (never from anything in the request
 * itself) — and NEVER by name, case-insensitive name, fuzzy match, or
 * `ssoPrefillKey`. See `extractHiddenFieldByQid` below.
 *
 * The real inbound serialization shape for a *hidden* field specifically
 * (as opposed to a normal visible question, which this integration has
 * directly observed via the prefill-URL mechanism) remains UNVERIFIED.
 * `extractHiddenFieldByQid` therefore checks the two qid-keyed shapes
 * this parser architecture already supports — never a name-based guess —
 * and this uncertainty is deliberately left explicit here rather than
 * papered over. The first real synthetic webhook delivery configured
 * against a live form remains the authoritative verification of which
 * shape Jotform actually sends.
 */
import type { JotformAnswerMap } from './extractMappedFields';

export type ParsedJotformWebhook = {
  formId: string;
  submissionId: string;
  /** qid-keyed answers, parsed from any `{qid}_{name}`-prefixed key in
      `rawRequest` — used for both reconciliation-mapped fields
      (fieldMapping.ts) and, via `extractHiddenFieldByQid`, for the two
      trusted hidden fields (solisLinkToken/solisWebhookAuth). */
  answers: JotformAnswerMap;
  /** The raw parsed `rawRequest` blob, kept alongside `answers` so
      `extractHiddenFieldByQid` can also check a bare-qid-keyed entry
      (e.g. `{"44": "value"}` or `{"44": {"answer": "value"}}`) — a second
      qid-keyed shape this integration has not ruled out, distinct from
      (and never a substitute for) any name-based lookup. */
  rawRequest: Record<string, unknown>;
};

const QID_PREFIX_PATTERN = /^q?(\d+)_(.+)$/;

function normalizeRawRequestEntry(key: string, value: unknown): { qid: string; name: string; value: unknown } | null {
  const match = QID_PREFIX_PATTERN.exec(key);
  if (!match) return null;
  return { qid: match[1], name: match[2], value };
}

export function parseJotformWebhookBody(fields: Record<string, unknown>): ParsedJotformWebhook | null {
  const formId = fields.formID;
  const submissionId = fields.submissionID;
  if (typeof formId !== 'string' || typeof submissionId !== 'string' || !formId || !submissionId) {
    return null;
  }

  let rawRequest: Record<string, unknown> = {};
  if (typeof fields.rawRequest === 'string') {
    try {
      const parsed = JSON.parse(fields.rawRequest);
      if (parsed && typeof parsed === 'object') rawRequest = parsed as Record<string, unknown>;
    } catch {
      rawRequest = {};
    }
  } else if (fields.rawRequest && typeof fields.rawRequest === 'object') {
    rawRequest = fields.rawRequest as Record<string, unknown>;
  }

  const answers: JotformAnswerMap = {};

  for (const [key, value] of Object.entries(rawRequest)) {
    const normalized = normalizeRawRequestEntry(key, value);
    if (!normalized) continue; // No qid-prefix on this key — never captured by name.

    const { qid, value: rawValue } = normalized;
    if (typeof rawValue === 'string') {
      answers[qid] = { answer: rawValue };
    } else if (rawValue && typeof rawValue === 'object') {
      answers[qid] = { answer: rawValue as Record<string, string> };
    }
  }

  return { formId, submissionId, answers, rawRequest };
}

/**
 * Extracts a hidden field's plain string value by its known, TRUSTED qid
 * — this qid must always come from a server-side-resolved
 * `ExternalFormConfig` row (`linkTokenFieldQid`/`webhookAuthFieldQid`),
 * never from anything in the incoming request. No name, case-insensitive
 * name, fuzzy match, or `ssoPrefillKey` fallback exists anywhere in this
 * function — an absent/mismatched qid simply returns null.
 *
 * Checks two qid-keyed shapes this parser architecture already supports
 * (see the module doc comment for why both remain plausible pending a
 * verified live delivery):
 *   1. `{qid}_{name}`-prefixed key in `rawRequest`, already normalized
 *      into `parsed.answers[qid]` by `parseJotformWebhookBody`.
 *   2. A bare `{qid: value}` or `{qid: {answer: value}}` entry directly
 *      in `parsed.rawRequest`.
 * A hidden hidden field (link token / webhook auth) is always a plain
 * string — a compound/object answer at the given qid is treated as "not
 * found" rather than guessed at.
 */
export function extractHiddenFieldByQid(
  parsed: Pick<ParsedJotformWebhook, 'answers' | 'rawRequest'>,
  qid: string,
): string | null {
  const fromAnswers = parsed.answers[qid];
  if (fromAnswers && typeof fromAnswers.answer === 'string' && fromAnswers.answer !== '') {
    return fromAnswers.answer;
  }

  const rawEntry = parsed.rawRequest[qid];
  if (typeof rawEntry === 'string' && rawEntry !== '') {
    return rawEntry;
  }
  if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)) {
    const value = (rawEntry as Record<string, unknown>).answer;
    if (typeof value === 'string' && value !== '') return value;
  }

  return null;
}
