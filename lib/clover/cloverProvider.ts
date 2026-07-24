import type { PaymentIntegration, PaymentRecord } from '../../types/payment';
import type {
  CheckoutSessionRequest,
  CheckoutSessionResult,
  PaymentProvider,
  ProviderPaymentUpdate,
  WebhookVerificationResult,
} from '../paymentProvider';
import { createCloverCheckoutSession, getCloverPayment } from './cloverClient';
import { getCloverWebhookSecret } from './cloverConfig';
import { verifyCloverSignature } from './cloverWebhook';

/**
 * Phase 19B (Clover Hosted Checkout Integration). The first, and so far
 * only, `PaymentProvider` implementation. See
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 */

/** Shape of the event Clover's Hosted Checkout webhook sends — confirmed
    from docs.clover.com/dev/docs/ecomm-hosted-checkout-webhook. Card
    details are never part of this payload (Clover's own webhook doesn't
    include them) — see getPaymentStatus below for how they're filled in. */
type CloverWebhookEvent = {
  createdTime: number;
  message?: string;
  status: 'APPROVED' | 'DECLINED' | string;
  type: string;
  id: string; // payment UUID
  merchantId: string;
  data: string; // checkout session UUID — the correlation key
};

function isCloverWebhookEvent(value: unknown): value is CloverWebhookEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    typeof (value as Record<string, unknown>).data === 'string' &&
    typeof (value as Record<string, unknown>).status === 'string'
  );
}

export const cloverProvider: PaymentProvider = {
  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSessionResult> {
    const result = await createCloverCheckoutSession(request.integration, {
      customer: {},
      shoppingCart: {
        lineItems: [
          {
            name: request.purpose,
            price: request.amount,
            unitQty: 1,
            // Phase 19B's own instruction: "Attach non-sensitive Beacon
            // correlation metadata where Clover supports it." Clover's
            // checkout-session body has no dedicated metadata field —
            // the per-line-item `note` is the one place available.
            note: `Beacon payment ${request.beaconPaymentId} — case ${request.caseId}`,
          },
        ],
      },
    });

    return { checkoutUrl: result.href, providerCheckoutId: result.checkoutSessionId };
  },

  verifyWebhook(rawBody: string, headers: Headers, integration: PaymentIntegration): WebhookVerificationResult {
    const secret = getCloverWebhookSecret(integration);
    const signatureHeader = headers.get('Clover-Signature');
    const verification = verifyCloverSignature(rawBody, signatureHeader, secret);

    if (!verification.valid) {
      return { valid: false, reason: verification.reason };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { valid: false, reason: 'Signature valid but body is not valid JSON.' };
    }

    return { valid: true, payload };
  },

  mapProviderPayment(payload: unknown): ProviderPaymentUpdate {
    if (!isCloverWebhookEvent(payload)) {
      throw new Error('Unrecognized Clover webhook payload shape.');
    }

    const succeeded = payload.status === 'APPROVED';
    const declined = payload.status === 'DECLINED';

    return {
      providerCheckoutId: payload.data,
      providerPaymentId: payload.id,
      // Anything other than a recognized terminal status is left
      // 'pending' rather than guessed at — an unrecognized status should
      // never be silently treated as success.
      status: succeeded ? 'succeeded' : declined ? 'failed' : 'pending',
      cardBrand: null,
      cardLast4: null,
      receiptReference: payload.id,
      failureCode: declined ? 'declined' : null,
      failureMessage: declined ? (payload.message ?? 'Payment declined.') : null,
    };
  },

  async getPaymentStatus(integration: PaymentIntegration, record: PaymentRecord): Promise<ProviderPaymentUpdate | null> {
    // Phase 19B / ADR-022 "documented gap": Clover does not publish an
    // endpoint to look up a Hosted Checkout session's status directly by
    // its checkoutSessionId before a payment exists for it — only the
    // standard `GET /v3/merchants/{mId}/payments/{id}` resource, which
    // needs a providerPaymentId. Until the webhook has fired at least
    // once (setting that field), there's nothing to reconcile yet.
    if (!record.providerPaymentId) return null;

    const payment = await getCloverPayment(integration, record.providerPaymentId);
    if (!payment) return null;

    const succeeded = payment.result === 'SUCCESS';

    return {
      providerCheckoutId: record.providerCheckoutId,
      providerPaymentId: payment.id,
      status: succeeded ? 'succeeded' : 'failed',
      cardBrand: payment.cardTransaction?.cardType ?? null,
      cardLast4: payment.cardTransaction?.last4 ?? null,
      receiptReference: payment.id,
      failureCode: succeeded ? null : 'declined',
      failureMessage: succeeded ? null : 'Payment declined.',
    };
  },
};
