/**
 * Phase 19A (Secure Payment Architecture). The provider-neutral shape a
 * future payment record will have once a real PCI-compliant provider
 * (Stripe, Square, ...) is integrated. Defined now so that integration has
 * an agreed target to build toward — nothing in this codebase constructs,
 * stores, reads, or transmits a value of this type yet; there is no Case
 * property, Wix collection, or Route Handler for it. "Do not implement a
 * payment provider yet" was this phase's own explicit instruction — this
 * type is the *design*, not the integration.
 *
 * Deliberately excludes any card data: a PaymentRecord is what Beacon
 * learns *about* a completed or attempted payment from the provider after
 * the fact (an identifier, a status, an amount, a brand/last-4 for
 * display) — never what it collected to make the charge happen. The PAN,
 * expiration, and CVV live and die inside the provider's own hosted
 * fields/SDK; Beacon never receives them, so there is nothing here that
 * could regress into storing them. See
 * docs/adr/ADR-021-secure-payment-architecture.md.
 */
export type PaymentRecord = {
  /** Which provider processed this payment — e.g. 'stripe', 'square'. Not
      a union of literal provider names on purpose: adding a new provider
      should never require a type change here. */
  provider: string;
  /** The provider's own identifier for the payment/charge/intent. */
  providerPaymentId: string;
  /** The provider's own identifier for the stored payment method (a
      tokenized card reference, never the PAN itself). */
  providerPaymentMethodId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  /** In the provider's smallest currency unit (e.g. cents for USD),
      matching how Stripe/Square both represent amounts — avoids
      floating-point ambiguity on money values. */
  amount: number;
  /** ISO 4217 currency code, lowercase (e.g. 'usd'). */
  currency: string;
  /** Display-only metadata a provider returns post-charge — e.g. 'visa'.
      Never enough information to reconstruct a card number. */
  cardBrand: string | null;
  /** Last 4 digits only — the one card-number-adjacent value that's
      standard, PCI-safe to display and store (every major provider
      returns this for exactly this purpose). */
  cardLast4: string | null;
  /** A provider- or organization-facing receipt/reference string for
      reconciliation — not itself sensitive. */
  receiptReference: string | null;
  /** ISO 8601 timestamp of when the provider confirmed the payment. */
  collectedAt: string;
  /** Optional processor authorization code, when a provider surfaces one. */
  authorizationCode?: string | null;
};
