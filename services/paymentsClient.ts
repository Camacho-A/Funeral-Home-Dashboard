import type { OrganizationContext } from '../types/organization';
import type { PaymentRecord } from '../types/payment';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Client-side calls to
 * app/api/cases/[caseId]/payments/* — same shape as
 * services/workflowTemplatesService.ts: never branches on DATA_ADAPTER
 * itself (invisible in the browser bundle), always calls the Route
 * Handler, which alone decides mock vs. wix.
 */

export async function listPayments(context: OrganizationContext, caseId: string): Promise<PaymentRecord[]> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}/payments?organizationId=${encodeURIComponent(context.organizationId)}`,
  );
  if (!response.ok) {
    throw new Error('Failed to load payment history.');
  }
  const body = (await response.json()) as { payments: PaymentRecord[] };
  return body.payments;
}

export async function getPayment(
  context: OrganizationContext,
  caseId: string,
  paymentId: string,
): Promise<PaymentRecord | null> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}/payments/${encodeURIComponent(paymentId)}?organizationId=${encodeURIComponent(context.organizationId)}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error('Failed to load payment status.');
  }
  const body = (await response.json()) as { payment: PaymentRecord | null };
  return body.payment;
}

export async function createCloverCheckout(
  context: OrganizationContext,
  caseId: string,
  input: { amount: number; currency?: string; purpose: string; idempotencyKey: string },
): Promise<{ paymentId: string; checkoutUrl: string }> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/payments/clover/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: context.organizationId, ...input }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to start Clover checkout.');
  }
  return response.json();
}

export async function cancelPayment(
  context: OrganizationContext,
  caseId: string,
  paymentId: string,
): Promise<PaymentRecord | null> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/payments/${encodeURIComponent(paymentId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: context.organizationId }),
  });
  if (!response.ok) {
    throw new Error('Failed to cancel payment.');
  }
  const body = (await response.json()) as { payment: PaymentRecord | null };
  return body.payment;
}

/** Mock-mode only — see app/api/cases/[caseId]/payments/[paymentId]/simulate/route.ts. */
export async function simulateMockPaymentSuccess(
  context: OrganizationContext,
  caseId: string,
  paymentId: string,
): Promise<PaymentRecord | null> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}/payments/${encodeURIComponent(paymentId)}/simulate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: context.organizationId }),
    },
  );
  if (!response.ok) {
    throw new Error('Failed to simulate payment outcome.');
  }
  const body = (await response.json()) as { payment: PaymentRecord | null };
  return body.payment;
}

export const paymentsClient = {
  listPayments,
  getPayment,
  createCloverCheckout,
  cancelPayment,
  simulateMockPaymentSuccess,
};
