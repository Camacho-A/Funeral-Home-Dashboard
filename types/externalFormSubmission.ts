/**
 * Manors Jotform integration (case-first architecture, 2026-09). Named
 * `ExternalFormSubmission` rather than the earlier "IntakeSubmission" —
 * that name assumed Jotform was the case-intake system, which the
 * case-first redesign explicitly rejected (a Solis case always exists
 * first; a submission only ever attaches to one). Kept provider-neutral
 * for the same reason `ExternalFormConfig` is.
 *
 * `status` and `pdfStatus` are deliberately independent state machines —
 * receiving a submission and preserving its original PDF are separate
 * operations that can fail independently (see
 * services/externalFormPdfService.ts's own comment). A submission is
 * never "lost" because its PDF retrieval failed; the two are tracked,
 * retried, and reported on separately.
 *
 * DATA MINIMIZATION (2026-09 pre-production hardening): this type
 * deliberately does NOT persist the full raw Jotform webhook payload.
 * The original design retained a `rawPayload` field (the entire webhook
 * body, verbatim) indefinitely — but that body can carry SSN, signature
 * data, and other legal/family PII this integration has no operational
 * need to store a second time. The original Jotform submission and its
 * original populated Smart PDF (preserved via `documentId`, through the
 * existing Solis document pipeline) remain the sole authoritative
 * artifacts for anything not captured in `mappedFields`. If a future
 * need genuinely requires re-deriving something not in `mappedFields`,
 * the correct mechanism is an explicit, authenticated, server-side
 * Jotform API fetch keyed by `externalFormId` + `externalSubmissionId`
 * — never a permanently duplicated payload store.
 */
export type ExternalFormSubmissionStatus = 'unmatched' | 'matched' | 'reviewed';
export type ExternalFormPdfStatus = 'not_applicable' | 'pending' | 'stored' | 'failed';

export type ExternalFormSubmission = {
  id: string; // deterministic: `${organizationId}-${provider}-${externalSubmissionId}` — see this file's own idempotency note below
  organizationId: string;
  provider: string;
  externalFormId: string;
  externalSubmissionId: string;
  /** Null until a webhook-matched or manually-linked submission resolves
      to a specific case+form-slot. */
  caseFormLinkId: string | null;
  status: ExternalFormSubmissionStatus;
  /** JSON-stringified Record<string, unknown> — the best-effort mapping
      of rawPayload onto Solis field names, computed once at receipt time
      using the owning ExternalFormConfig.fieldMap. Recomputing this is
      cheap and deterministic, so it's a cache of that computation, never
      an independent source of truth. */
  mappedFields: string;
  receivedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null; // StaffProfile id
  /** Set once the original populated PDF is successfully stored — points
      at the resulting CaseDocument. Null while pdfStatus is anything
      other than 'stored'. */
  documentId: string | null;
  pdfStatus: ExternalFormPdfStatus;
  pdfFailureReason: string | null; // sanitized — never a raw provider error body
  /**
   * Historical-case-creation (2026-09). Null until this submission is
   * used to create a NEW Solis case (as opposed to being linked to an
   * already-existing one — see caseFormLinkId above, which is what the
   * "existing case" import path uses instead). This is the crash-recovery
   * checkpoint for that workflow: once a real case id is persisted here,
   * a retry must never attempt to create a second case for the same
   * submission, only resume linking.
   *
   * Also doubles as a compare-and-swap claim/fence during case creation
   * itself, via a reserved, non-UUID-shaped sentinel prefix
   * (`CLAIMING:<token>`, see services/externalFormSubmissionService.ts's
   * claimForCaseCreation) — never a bare case id while a creation attempt
   * is in flight. Application code must treat any value starting with
   * `CLAIMING:` as "not yet a real case," never as `caseId`.
   */
  createdCaseId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The natural external-submission identity this integration is built
    around — `organizationId + provider + externalSubmissionId` — used
    both as this row's deterministic id (a redelivered webhook is a
    duplicate-key insert, not a new row) and as the document-idempotency
    key PDF storage keys off (see externalFormPdfService.ts). */
export function externalFormSubmissionId(organizationId: string, provider: string, externalSubmissionId: string): string {
  return `${organizationId}-${provider}-${externalSubmissionId}`;
}

/** Historical-case-creation (2026-09) — see `createdCaseId`'s own comment
    above. A real case id is always a bare `crypto.randomUUID()` value;
    this prefix is chosen so a claim token can never collide with one. */
const CASE_CREATION_CLAIM_PREFIX = 'CLAIMING:';

export function buildCaseCreationClaimToken(token: string): string {
  return `${CASE_CREATION_CLAIM_PREFIX}${token}`;
}

export function isCaseCreationClaimToken(value: string | null): boolean {
  return typeof value === 'string' && value.startsWith(CASE_CREATION_CLAIM_PREFIX);
}
