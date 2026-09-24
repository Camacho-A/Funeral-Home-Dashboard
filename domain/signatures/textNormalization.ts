/**
 * SOLIS-wide ALL-CAPS data standard (2026-09). SignatureRequest.signerName
 * is staff-entered operational person-name data (the staff member names
 * who needs to sign, at request-creation time) — same character as
 * Case.nextOfKinName. Deliberately does NOT cover:
 * - SignatureRequest.declineReason — often the signer's own words, not
 *   staff's; excluded on product/tone grounds, not a technical one.
 * - SignatureRecord.signedName / initials — the signer's own typed legal
 *   attestation (ADR-030's "the actual legally-relevant artifact");
 *   altering its case risks being read as altering the legal record.
 * Neither of the above is touched anywhere in this codebase — this module
 * intentionally does not export a function for them.
 */
export function normalizeSignatureRequestTextFields<T extends { signerName?: unknown }>(input: T): T {
  if (typeof input.signerName === 'string') {
    return { ...input, signerName: input.signerName.toUpperCase() };
  }
  return input;
}
