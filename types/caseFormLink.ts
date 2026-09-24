/**
 * Manors Jotform integration (case-first architecture, 2026-09). One row
 * per (case, form-slot) — a Case may have zero, one, or many of these,
 * one per `ExternalFormConfig` the organization has configured. This is
 * what the Case Detail "Forms" section renders one row per, and what a
 * webhook-received submission resolves against via its opaque token.
 *
 * Only `linkTokenHash` is ever persisted — the raw token exists only
 * transiently, server-side, long enough to build one prefilled provider
 * URL (see domain/externalForms/prefillUrl.ts) before being discarded.
 * Regenerating overwrites `linkTokenHash` with a fresh hash, which
 * structurally invalidates the previous raw token (its hash no longer
 * matches anything stored) without needing a separate revocation list.
 */
export type CaseFormLinkStatus = 'not_sent' | 'sent' | 'received' | 'reviewed';

export type CaseFormLink = {
  id: string;
  organizationId: string;
  caseId: string;
  provider: string;
  formConfigId: string;
  linkTokenHash: string;
  status: CaseFormLinkStatus;
  /** Set when a link is generated/sent — this is the one "Sent" fact
      Solis can actually know (see the Case Detail Forms design). */
  sentAt: string | null;
  /** Set once a webhook-matched or manually-linked submission resolves
      to this slot. */
  submissionId: string | null;
  createdAt: string;
  updatedAt: string;
};
