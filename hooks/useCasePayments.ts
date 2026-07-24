import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentsClient } from '@/services/paymentsClient';
import { useOrganization } from './useOrganization';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Same
 * organizationId-leading query-key convention as every other
 * organization-scoped hook (useCase, useCases, ...).
 */

export function useCasePayments(caseId: string) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['casePayments', organization.organizationId, caseId],
    queryFn: () => paymentsClient.listPayments(organization, caseId),
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

export function useCreateCloverCheckout(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { amount: number; currency?: string; purpose: string; idempotencyKey: string }) =>
      paymentsClient.createCloverCheckout(organization, caseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['casePayments', organization.organizationId, caseId] });
    },
  });
}

/** Used by the payments/return page for both outcomes: a real cancel
    redirect, and (mock mode only) simulating a successful webhook. */
export function useResolveReturnedPayment(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  function invalidate(paymentId: string) {
    queryClient.invalidateQueries({ queryKey: ['casePayment', organization.organizationId, caseId, paymentId] });
    queryClient.invalidateQueries({ queryKey: ['casePayments', organization.organizationId, caseId] });
  }

  const cancel = useMutation({
    mutationFn: (paymentId: string) => paymentsClient.cancelPayment(organization, caseId, paymentId),
    onSuccess: (_, paymentId) => invalidate(paymentId),
  });

  const simulateSuccess = useMutation({
    mutationFn: (paymentId: string) => paymentsClient.simulateMockPaymentSuccess(organization, caseId, paymentId),
    onSuccess: (_, paymentId) => invalidate(paymentId),
  });

  return { cancel, simulateSuccess };
}
