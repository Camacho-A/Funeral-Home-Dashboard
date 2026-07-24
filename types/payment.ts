/**
 * Phase 19A (Secure Payment Architecture) defined `PaymentRecord` as a
 * documentation-only target shape — nothing constructed, stored, or read
 * one. Phase 19B (Clover Hosted Checkout Integration) is what makes it
 * real: a genuinely persisted type (`paymentRecords` Wix collection, or
 * the mock fixture equivalent), plus `PaymentIntegration`, the
 * organization-scoped configuration a provider needs to operate at all.
 * See docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 *
 * Both types are still deliberately provider-neutral: `provider` is a
 * plain string, never a literal union, so adding Stripe or Square later
 * never requires a type change here — only a new `lib/<provider>/*`
 * implementing `lib/paymentProvider.ts`'s `PaymentProvider` interface.
 *
 * Neither type has, or will ever have, a field for a PAN, CVV, expiration
 * date, track data, or PIN data — see lib/paymentFieldGuard.ts and
 * ADR-021 for why that boundary is enforced structurally, not just by
 * convention here.
 */

export type PaymentRecordStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';

/**
 * One payment *attempt* against one case. A case can have many —
 * deposits, balances, a failed attempt followed by a successful retry —
 * so this is never a singleton on `Case`; see services/paymentsService.ts.
 */
export type PaymentRecord = {
  id: string;
  organizationId: string;
  caseId: string;
  /** e.g. 'clover'. Not a literal union — see file comment above. */
  provider: string;
  /** The provider's hosted-checkout session identifier — the field every
      webhook event is correlated against (never the browser redirect —
      see ADR-022's "redirect is not authoritative"). Before Clover has
      assigned a real one, this holds a placeholder guaranteed unique to
      this record (`pending:{id}`), never an empty string — confirmed
      empirically against the live Wix collection that two rows sharing
      an empty value in a unique-indexed field conflict exactly like any
      other duplicate (error `WDE0123`), so an empty-string placeholder
      would have made it impossible to ever have two pending payments
      awaiting a Clover session at once. */
  providerCheckoutId: string;
  /** Caller-supplied idempotency token for *this checkout attempt* —
      unique per organization, enforced by a real Wix unique index (see
      services/paymentsService.ts's createIdempotentPendingPaymentRecord).
      Wix Data's unique index only supports a single field, not a genuine
      compound (organizationId, idempotencyKey) constraint, so the value
      actually stored and indexed is `{organizationId}:{clientKey}` —
      composed server-side, giving the exact same practical guarantee
      (no two records for the same organization can ever share a client
      key) without relying on cross-organization key collisions being
      merely improbable. See ADR-022. */
  idempotencyKey: string;
  /** The provider's own identifier for the completed payment/charge —
      null until a webhook (or a status poll) confirms one exists. */
  providerPaymentId: string | null;
  status: PaymentRecordStatus;
  /** In the provider's smallest currency unit (cents for USD) — matches
      PaymentRecord's Phase 19A precedent and how Clover's own API
      represents amounts. */
  amount: number;
  /** ISO 4217 currency code, lowercase (e.g. 'usd'). */
  currency: string;
  /** What this specific payment was for (e.g. "Cremation service fee") —
      operator-facing, never sensitive. */
  purpose: string;
  /** The provider's own hosted checkout page URL — public-facing by
      design (Clover serves it to anyone holding the link), so storing it
      is no more sensitive than the checkout id itself. Not in Phase 19B's
      original field list, but added deliberately: without it, an
      idempotency check that reuses a still-valid pending session (rather
      than creating a stray duplicate on a double-click or reload) would
      have nothing to hand back to the caller. Null once the session has
      expired or a payment has completed — never re-used past that. */
  checkoutUrl: string | null;
  /** Display-only metadata a provider returns post-charge — e.g. 'visa'.
      Never enough information to reconstruct a card number. */
  cardBrand: string | null;
  /** Last 4 digits only — the one card-number-adjacent value that's
      standard, PCI-safe to display and store. */
  cardLast4: string | null;
  /** A provider- or organization-facing receipt/reference string for
      reconciliation — not itself sensitive. */
  receiptReference: string | null;
  /** Machine-readable failure reason, when status is 'failed' — provider-
      specific string, passed through as-is for support/debugging. */
  failureCode: string | null;
  /** Human-readable failure message, when status is 'failed'. Never
      derived from raw card data — a decline reason like "insufficient
      funds" or "card declined", not anything about the PAN itself. */
  failureMessage: string | null;
  createdAt: string;
  /** Set only once a webhook (or status poll) confirms success — null for
      pending/failed/cancelled records. */
  paidAt: string | null;
  updatedAt: string;
};

/**
 * Which payment provider is configured for one organization, and how to
 * reach it — never a secret itself. `merchantIdReference`,
 * `credentialReference`, and `webhookSecretReference` are all *names*,
 * resolved against server-only environment variables
 * (lib/clover/cloverConfig.ts) for this phase's one real tenant; the
 * indirection is what lets a future per-organization encrypted-secret
 * store replace that resolution mechanism without this type, or anything
 * that reads it, changing at all. Every reference name must be
 * environment-specific — a `sandbox` row and a future `production` row
 * for the same organization/provider must never name the same variables
 * (e.g. `CLOVER_MANORS_SANDBOX_PRIVATE_KEY` vs.
 * `CLOVER_MANORS_PRODUCTION_PRIVATE_KEY`), so activating production can
 * never accidentally run against sandbox credentials or vice versa.
 */
export type PaymentIntegration = {
  id: string;
  organizationId: string;
  provider: string;
  environment: 'sandbox' | 'production';
  /** Name of the environment variable holding the provider's merchant
      identifier. Not secret in principle (it identifies the account,
      doesn't authenticate against it), but kept in the same
      env-var-reference form as the other two for one consistent
      resolution mechanism (lib/clover/cloverConfig.ts) rather than a
      mixed Wix-field/env-var split. */
  merchantIdReference: string;
  /** Name of the environment variable holding the provider's private
      API key/OAuth token — e.g. 'CLOVER_MANORS_SANDBOX_PRIVATE_KEY'. */
  credentialReference: string;
  /** Name of the environment variable holding the webhook signing
      secret — e.g. 'CLOVER_MANORS_SANDBOX_WEBHOOK_SECRET'. */
  webhookSecretReference: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};
