import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { paymentsClient } from '@/services/paymentsClient';
import { useOrganization } from './useOrganization';
import { withMockPaymentStatusSync } from './mockPaymentStatusSync';
import type { ManualPaymentMethod } from '@/domain/billing/manualPaymentMethods';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Same
 * organizationId-leading query-key convention as every other
 * organization-scoped hook (useCase, useCases, ...).
 */

/**
 * Everything on the case page that a payment can move (2026-10): the
 * payment history, the Case Order's balance, and the case itself — the
 * server marks a case "Paid in full" when a verified payment clears its
 * balance (services/paymentWorkflow.ts markCasePaidIfVerified), and the
 * Case Information "Payment" field only shows that once ['case', …] is
 * read again.
 */
export function invalidateCasePaymentState(queryClient: QueryClient, organizationId: string, caseId: string) {
  queryClient.invalidateQueries({ queryKey: ['casePayments', organizationId, caseId] });
  queryClient.invalidateQueries({ queryKey: ['caseOrder', organizationId, caseId] });
  queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] });
}

export function useCasePayments(caseId: string, enabled: boolean = true) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['casePayments', organization.organizationId, caseId],
    queryFn: () => paymentsClient.listPayments(organization, caseId),
    enabled,
  });
}

const PAYMENT_POLL_INTERVAL_MS = 2500;

/**
 * Polls one payment's status every 2.5s while it remains 'pending' —
 * used by the payments/return page while it waits for the webhook (or the
 * GET route's own best-effort Clover reconciliation) to resolve a final
 * status. Stops polling automatically once a terminal status is reached.
 */
export function useCasePaymentStatus(caseId: string, paymentId: string | null) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['casePayment', organization.organizationId, caseId, paymentId],
    queryFn: () => paymentsClient.getPayment(organization, caseId, paymentId as string),
    enabled: paymentId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? PAYMENT_POLL_INTERVAL_MS : false),
  });
}

export function useRecordManualPayment(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { method: ManualPaymentMethod; amountCents: number; reference?: string; purpose?: string; idempotencyKey: string }) =>
      withMockPaymentStatusSync(organization, caseId, () => paymentsClient.recordManualPayment(organization, caseId, input)),
    onSuccess: () => invalidateCasePaymentState(queryClient, organization.organizationId, caseId),
  });
}

/** Used by the payments/return page for both outcomes: a real cancel
    redirect, and (mock mode only) simulating a successful webhook. */
export function useResolveReturnedPayment(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  function invalidate(paymentId: string) {
    queryClient.invalidateQueries({ queryKey: ['casePayment', organization.organizationId, caseId, paymentId] });
    invalidateCasePaymentState(queryClient, organization.organizationId, caseId);
  }

  const cancel = useMutation({
    mutationFn: (paymentId: string) => paymentsClient.cancelPayment(organization, caseId, paymentId),
    onSuccess: (_, paymentId) => invalidate(paymentId),
  });

  const simulateSuccess = useMutation({
    mutationFn: (paymentId: string) =>
      withMockPaymentStatusSync(organization, caseId, () => paymentsClient.simulateMockPaymentSuccess(organization, caseId, paymentId)),
    onSuccess: (_, paymentId) => invalidate(paymentId),
  });

  return { cancel, simulateSuccess };
}
