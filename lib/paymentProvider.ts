import type { PaymentIntegration, PaymentRecord } from '../types/payment';

/**
 * Phase 19B (Clover Hosted Checkout Integration). The provider-neutral
 * boundary every payment provider (Clover today; Stripe/Square whenever
 * they're added) implements — nothing in `app/api/cases/[caseId]/payments/*`
 * or `services/paymentsService.ts` imports a Clover-specific type or calls
 * a Clover-specific function directly; they only ever hold a
 * `PaymentProvider` and call these four methods. Adding a second provider
 * later means writing `lib/<provider>/*Provider.ts` and one line in
 * `getPaymentProvider()` (services/paymentsService.ts) — no change to
 * case-domain logic, routes, or UI. See
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 */

export type CheckoutSessionRequest = {
  integration: PaymentIntegration;
  /** Smallest currency unit (cents for USD) — server-validated before
      this is ever called; see the checkout route's own comment. */
  amount: number;
  currency: string;
  purpose: string;
  /** Beacon's own PaymentRecord id, for embedding in the return-page
      redirect URLs (a UX hint only — never authoritative; see
      ADR-022's "redirect is not authoritative"). */
  beaconPaymentId: string;
  caseId: string;
  /** Absolute URLs the provider should redirect the browser to after the
      customer finishes (or cancels) — both point at Beacon's own
      /cases/[caseId]/payments/return page, disambiguated by a query
      param, since that page always re-confirms status server-side rather
      than trusting which URL it landed on. */
  returnUrl: string;
  cancelUrl: string;
};

export type CheckoutSessionResult = {
  checkoutUrl: string;
  /** The provider's own session identifier — stored as
      PaymentRecord.providerCheckoutId, the sole webhook-correlation key. */
  providerCheckoutId: string;
};

export type WebhookVerificationResult =
  | { valid: true; payload: unknown }
  | { valid: false; reason: string };

/** What a verified webhook (or a status poll) tells Beacon about one
    payment — always mapped through `mapProviderPayment`, never used to
    construct a `PaymentRecord` update directly, so a provider-specific
    payload shape never leaks past its own module. */
export type ProviderPaymentUpdate = {
  providerCheckoutId: string;
  providerPaymentId: string | null;
  status: PaymentRecord['status'];
  cardBrand: string | null;
  cardLast4: string | null;
  receiptReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export interface PaymentProvider {
  /** Creates a new hosted checkout session for one payment attempt. */
  createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSessionResult>;

  /** Verifies a webhook request is genuinely from this provider — checked
      against the raw request body (never a re-serialized/parsed one; see
      the webhook route's own comment on why). Returns the parsed payload
      only once verification succeeds, so a caller can never accidentally
      act on an unverified body. */
  verifyWebhook(rawBody: string, headers: Headers, integration: PaymentIntegration): WebhookVerificationResult;

  /** Maps an already-verified webhook payload (or a status-poll response)
      into the provider-neutral update shape every `PaymentRecord` write
      goes through. */
  mapProviderPayment(payload: unknown): ProviderPaymentUpdate;

  /** Queries the provider directly for a payment's current status — used
      by the return page's polling loop as a fallback while waiting for
      the webhook, and by anything that needs to reconcile state
      independent of webhook delivery. Takes the current PaymentRecord
      (not just its checkout id) because a provider may only be able to
      look a payment up once it has already learned a
      `providerPaymentId` from a prior webhook — see
      lib/clover/cloverProvider.ts's own comment on this documented gap.
      Returns null when there is nothing new to report. */
  getPaymentStatus(integration: PaymentIntegration, record: PaymentRecord): Promise<ProviderPaymentUpdate | null>;
}
