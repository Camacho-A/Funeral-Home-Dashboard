/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). The
 * immutable half of the signing feature — see `types/signatureRequest.ts`
 * for the mutable workflow half. A `SignatureRecord` is the actual
 * legally-relevant artifact of one completed signature: who signed, what
 * they typed, from where, when, and verified against what document
 * checksum. **Insert-only. Never updated, never deleted, once created.**
 *
 * This is domain data, not audit infrastructure — it exists because the
 * Documents tab (and any future legal-export feature) needs fast,
 * structured, indexed access to "who signed this and when," which a JSON
 * blob buried in an ActivityEvent's `metadata` field cannot provide
 * efficiently. The audit *narrative* ("who did what when," for the
 * Signature History timeline) still comes entirely from
 * `services/activityService.ts` — these are two different concerns that
 * happen to describe related facts; no second audit system is
 * introduced by this type. See
 * docs/adr/ADR-030-electronic-signatures-and-authorization-workflows.md.
 */

import type { SignerRole } from './signatureRequest';

/** Extensible later (drawn signature, click-to-sign, etc.) — see this
    phase's own named extension points. A typed, attested signature is
    this phase's deliberate scope boundary, legally sufficient under
    ESIGN/UETA's "electronic sound, symbol, or process" definition. */
export type SignatureMethod = 'typed_name';

/** The outcome of re-verifying the signed document's SHA-256 checksum at
    the moment of signing (tamper detection) — 'unverified' should never
    actually occur in a completed record (a mismatch rejects the sign
    attempt outright before a record is ever created), but the field
    exists so a completed record always states this explicitly rather
    than assuming it. */
export type SignatureVerificationStatus = 'verified' | 'unverified';

export type SignatureRecord = {
  id: string;
  organizationId: string;
  caseId: string;
  documentId: string;
  /** CaseDocument.version at the exact moment of signing. */
  documentVersion: number;
  /** -> SignatureRequest.id. Never the reverse — a request may exist
      without a record (declined/expired/cancelled), but a record always
      names the exact request that produced it. */
  signatureRequestId: string;
  signerName: string;
  signerEmail: string;
  signerRole: SignerRole;
  /** The typed attestation text the signer actually entered. */
  signedName: string;
  initials: string | null;
  ipAddress: string;
  userAgent: string;
  signatureMethod: SignatureMethod;
  verificationStatus: SignatureVerificationStatus;
  /** CaseDocument.checksumSha256 AT signing time — a permanent historical
      fact, recorded here independently of whatever the document's own
      row happens to say later (it never changes after this, since a
      signed document is permanently locked, but this field's presence
      doesn't depend on that invariant holding). */
  documentChecksumSha256: string;
  /** Schema-evolution reserve, mirrors ActivityEvent.eventVersion and
      SignatureRequest.requestVersion — starts at 1. */
  recordVersion: number;
  correlationId: string;
  signedAt: string;
};

export type NewSignatureRecordInput = {
  signatureRequestId: string;
  signedName: string;
  initials?: string;
  ipAddress: string;
  userAgent: string;
};
