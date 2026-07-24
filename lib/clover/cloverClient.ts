import type { PaymentIntegration } from '../../types/payment';
import { getCloverApiBaseUrl, getCloverMerchantId, getCloverPrivateKey } from './cloverConfig';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Direct Clover REST API
 * access via `fetch` — same pattern as lib/wixDataApi.ts (a thin,
 * directly-testable wrapper, global `fetch` stubbed in tests rather than
 * a bespoke transport abstraction). Endpoint shapes below are confirmed
 * from Clover's own developer documentation
 * (docs.clover.com/dev/docs/creating-a-hosted-checkout-session); see
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md for what's
 * confirmed vs. assumed.
 */

export class CloverApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloverApiError';
    this.status = status;
  }
}

export type CloverCheckoutRequestBody = {
  customer: { email?: string; firstName?: string; lastName?: string };
  shoppingCart: {
    lineItems: Array<{ name: string; price: number; unitQty: number; note?: string }>;
  };
};

export type CloverCheckoutResponse = {
  href: string;
  checkoutSessionId: string;
  createdTime: number;
  expirationTime: number;
};

function cloverHeaders(privateKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${privateKey}`,
  };
}

/**
 * Creates a Hosted Checkout session. Clover's own docs don't specify a
 * request-level idempotency-key mechanism (see ADR-022) — duplicate
 * checkout prevention is handled one layer up, in services/paymentsService.ts,
 * by checking for an existing pending PaymentRecord before this is ever
 * called.
 */
export async function createCloverCheckoutSession(
  integration: PaymentIntegration,
  body: CloverCheckoutRequestBody,
): Promise<CloverCheckoutResponse> {
  const privateKey = getCloverPrivateKey(integration);
  const merchantId = getCloverMerchantId(integration);
  const baseUrl = getCloverApiBaseUrl(integration.environment);

  const response = await fetch(`${baseUrl}/invoicingcheckoutservice/v1/checkouts`, {
    method: 'POST',
    headers: {
      ...cloverHeaders(privateKey),
      'X-Clover-Merchant-Id': merchantId,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new CloverApiError(`Clover checkout session creation failed (HTTP ${response.status}).`, response.status);
  }

  return response.json();
}

export type CloverPayment = {
  id: string;
  result: 'SUCCESS' | 'FAIL' | string;
  cardTransaction?: { cardType?: string; last4?: string };
};

/**
 * Fetches a payment by Clover's own payment id — the standard, long-
 * documented Clover REST resource (`GET /v3/merchants/{mId}/payments/{id}`),
 * distinct from the Hosted-Checkout-specific endpoints above. Only usable
 * once a `providerPaymentId` is already known (i.e. after a webhook has
 * fired at least once) — Clover does not document a way to query a
 * Hosted Checkout session's status before that. See
 * lib/clover/cloverProvider.ts's getPaymentStatus and ADR-022's
 * "documented gap" note.
 */
export async function getCloverPayment(
  integration: PaymentIntegration,
  paymentId: string,
): Promise<CloverPayment | null> {
  const privateKey = getCloverPrivateKey(integration);
  const merchantId = getCloverMerchantId(integration);
  const baseUrl = getCloverApiBaseUrl(integration.environment);

  const response = await fetch(`${baseUrl}/v3/merchants/${merchantId}/payments/${paymentId}`, {
    method: 'GET',
    headers: cloverHeaders(privateKey),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new CloverApiError(`Clover payment lookup failed (HTTP ${response.status}).`, response.status);
  }

  return response.json();
}
