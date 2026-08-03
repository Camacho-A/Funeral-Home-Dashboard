/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). The mutable
 * workflow half of the signing feature — see `types/signatureRecord.ts`
 * for the other half. A `SignatureRequest` represents "someone has been
 * asked to sign a specific, already-generated `CaseDocument`," and
 * nothing more; its `status` field is the only thing that ever changes
 * on a row after creation. The actual legally-relevant facts of a
 * *completed* signature live on a separate, immutable `SignatureRecord`
 * row instead — deliberately two entities, not one row with optional
 * fields, so a future multi-signer/witness workflow is just more rows in
 * both tables, never a schema change. See
 * docs/adr/ADR-030-electronic-signatures-and-authorization-workflows.md.
 */

/**
 * A descriptive label for the signer's relationship to the case — not an
 * RBAC principal. Every signer, regardless of role (including a funeral
 * director or internal staff member signing their own generated
 * document), uses the identical token-link public signing flow: one
 * signing pathway, not two, keeps the audit trail and security model
 * uniform.
 */
export type SignerRole =
  | 'primary_contact'
  | 'secondary_contact'
  | 'next_of_kin'
  | 'authorized_representative'
  | 'funeral_director'
  | 'internal_staff';

export type SignatureRequestStatus =
  | 'draft'      // created; the signer notification has not yet successfully sent
  | 'pending'    // notification sent, awaiting the signer
  | 'viewed'     // signer has opened the link at least once
  | 'signed'     // terminal — a SignatureRecord now exists; the document is permanently locked
  | 'declined'   // terminal — signer explicitly declined
  | 'expired'    // terminal — expiresAt passed before completion
  | 'cancelled'; // terminal — staff revoked the request

export type SignatureRequest = {
  id: string;
  organizationId: string;
  caseId: string;
  /** -> CaseDocument.id. The exact immutable document being requested for
      signature — never a template or template version directly. */
  documentId: string;
  /** CaseDocument.version, pinned at request time — informational only;
      the referenced document itself never changes underneath a request. */
  documentVersion: number;
  signerName: string;
  signerEmail: string;
  signerRole: SignerRole;
  status: SignatureRequestStatus;
  /** SHA-256 hex of the raw signing token. The raw token itself is never
      persisted, logged, or returned in any response body after the call
      that issues/rotates it — treated identically to a password-reset
      token (see lib/identity/tokens.ts). */
  tokenHash: string;
  issuedAt: string;
  /** Optional — omitted at creation resolves to a sane default (see
      ADR-030's Security section) rather than a truly indefinite link. */
  expiresAt: string | null;
  /** Schema-evolution reserve, mirrors ActivityEvent.eventVersion exactly
      — starts at 1, lets a future phase evolve this row's meaning
      without breaking how old rows are read. */
  requestVersion: number;
  /** Reserved for future multi-signer sequencing (sequential signing) —
      always 1 this phase. Multiple concurrent SignatureRequest rows per
      documentId are how a future parallel-signing feature is expected to
      work; this phase's own business rule (enforced in
      services/signatureService.ts, not the schema) allows at most one
      active request per document at a time regardless of this field. */
  sequenceOrder: number;
  /** The staff member (identityId/userId) who created the request. */
  requestedBy: string;
  viewedAt: string | null;
  /** Workflow-transition timestamp only — the rich detail of a completed
      signature (who, what they typed, from where, verified against what
      checksum) lives on the corresponding SignatureRecord row instead. */
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  /** Reserved for a future reminder feature — no scheduler exists in
      this codebase this phase; reminders are sent only via an explicit
      staff-triggered resend. */
  lastRemindedAt: string | null;
  reminderCount: number;
  /** Shared with every ActivityEvent this request's own actions produce. */
  correlationId: string;
};

export type NewSignatureRequestInput = {
  caseId: string;
  documentId: string;
  signerName: string;
  signerEmail: string;
  signerRole: SignerRole;
  expiresAt?: string;
};
