/**
 * Manors Jotform integration (case-first architecture, 2026-09). Parses a
 * Jotform webhook delivery's form-encoded body into the shapes the rest
 * of this integration needs. Jotform's documented webhook POST carries
 * `formID`, `submissionID`, and `rawRequest` (a JSON-stringified blob of
 * every answer, including hidden fields) — confirmed from documentation,
 * but NOT independently verified against a real live delivery (no
 * webhook was configured during this integration's research pass, by
 * design). `rawRequest`'s own key convention (`q{qid}_{name}` for a
 * simple field, `q{qid}_{name}[{subfield}]` for a compound one) mirrors
 * the URL-prefill convention this integration already verified — this is
 * the best-grounded assumption available without a real payload to
 * inspect, and is isolated to this one module specifically so it can be
 * corrected in one place once a real delivery can be examined.
 */
import type { JotformAnswerMap } from './extractMappedFields';

/**
 * Jotform pre-production hardening (2026-09). The hidden field carrying
 * SOLIS's webhook-authenticity shared secret — deliberately distinct from
 * `ExternalFormConfig.linkTokenFieldName` (`solisLinkToken`), which
 * identifies a specific Case/form slot, never authenticates the request
 * itself. A fixed, single field name (not per-org configurable) since
 * this secret is a single shared value across every SOLIS-configured
 * Jotform form, not a per-case value — see
 * lib/jotform/jotformWebhookVerification.ts for the comparison itself.
 */
export const WEBHOOK_AUTH_FIELD_NAME = 'solisWebhookAuth';

/**
 * Deliberately independent of `parseJotformWebhookBody` below — this must
 * succeed (or safely fail) even for an otherwise-malformed body (missing
 * formID/submissionID), so that webhook authentication is checked before,
 * and regardless of, whether the rest of the payload parses — an
 * unauthenticated caller must never be able to distinguish "malformed"
 * from "wrong secret" by response shape alone. Looks in two places,
 * mirroring solisLinkToken's own two-shape tolerance (a hidden field may
 * arrive as a bare top-level form field, or nested inside the
 * `rawRequest` JSON blob) — NOT independently verified against a real
 * Jotform delivery (no live webhook has been configured); isolated here
 * for easy correction once a real payload can be examined. Never a fuzzy
 * match — only this exact field name, in these two exact shapes.
 */
export function extractWebhookAuthValue(fields: Record<string, unknown>): string | null {
  if (typeof fields[WEBHOOK_AUTH_FIELD_NAME] === 'string' && fields[WEBHOOK_AUTH_FIELD_NAME] !== '') {
    return fields[WEBHOOK_AUTH_FIELD_NAME] as string;
  }
  if (typeof fields.rawRequest === 'string') {
    try {
      const parsed = JSON.parse(fields.rawRequest);
      const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[WEBHOOK_AUTH_FIELD_NAME] : undefined;
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // Malformed rawRequest — the auth value simply wasn't found; the
      // caller (verifyJotformWebhook) treats this identically to "missing".
    }
  }
  return null;
}

export type ParsedJotformWebhook = {
  formId: string;
  submissionId: string;
  answers: JotformAnswerMap;
  /** The raw hidden-field lookup — separate from `answers` since the
      link token field won't appear in any FieldMapEntry (it's not a
      reconciliation-mapped field). May also incidentally contain
      `solisWebhookAuth` if present in this shape — never a persistence
      concern, since nothing ever serializes this Map wholesale; it is
      only ever read via a single targeted `.get(name)` lookup (link
      token here, webhook-auth via `extractWebhookAuthValue` above,
      checked independently and earlier in the request lifecycle). */
  rawFieldsByName: Map<string, string>;
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
  const rawFieldsByName = new Map<string, string>();

  for (const [key, value] of Object.entries(rawRequest)) {
    const normalized = normalizeRawRequestEntry(key, value);

    if (!normalized) {
      // No qid-prefix — a hidden field (like the link token) may be
      // keyed by its bare name alone rather than `{qid}_{name}`. Not
      // independently verified against a real Jotform delivery (no
      // webhook was configured during this integration's research
      // pass) — handled here defensively so either shape resolves
      // correctly once we can confirm which one Jotform actually sends.
      if (typeof value === 'string') rawFieldsByName.set(key, value);
      continue;
    }

    const { qid, value: rawValue } = normalized;
    if (typeof rawValue === 'string') {
      answers[qid] = { answer: rawValue };
      rawFieldsByName.set(normalized.name, rawValue);
    } else if (rawValue && typeof rawValue === 'object') {
      const subObject = rawValue as Record<string, string>;
      answers[qid] = { answer: subObject };
      // A hidden field is always a plain string, never compound — no
      // rawFieldsByName entry needed for the object case.
    }
  }

  return { formId, submissionId, answers, rawFieldsByName };
}
