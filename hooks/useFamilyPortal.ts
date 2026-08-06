import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFamilyCases,
  fetchFamilyCase,
  fetchFamilyTimeline,
  fetchFamilyDocuments,
  fetchFamilySignatureRequests,
  completeFamilySignatureRequest,
  declineFamilySignatureRequest,
  fetchFamilyAppointments,
  fetchFamilyPayments,
  initiateFamilyPaymentCheckout,
  fetchFamilyPaymentStatus,
  simulateFamilyPaymentSuccess,
  cancelFamilyPayment,
  fetchFamilyMessages,
  sendFamilyMessageRequest,
} from '@/lib/familyClient';

/**
 * Phase 29 (Family Portal & External Collaboration). Query/mutation hooks
 * for the `/family/*` surface's own case data — bundled in one file the
 * same way `hooks/useRbac.ts` bundles all of `/api/rbac/*`'s hooks. Never
 * imports from or is imported by any staff-side `hooks/use*.ts` module.
 */
const casesKey = ['familyCases'];
const caseKey = (caseId: string) => ['familyCase', caseId];
const timelineKey = (caseId: string) => ['familyTimeline', caseId];
const documentsKey = (caseId: string) => ['familyDocuments', caseId];
const signatureRequestsKey = (caseId: string) => ['familySignatureRequests', caseId];
const appointmentsKey = (caseId: string) => ['familyAppointments', caseId];
const paymentsKey = (caseId: string) => ['familyPayments', caseId];
const messagesKey = (caseId: string) => ['familyMessages', caseId];

export function useFamilyCases() {
  return useQuery({ queryKey: casesKey, queryFn: fetchFamilyCases });
}

export function useFamilyCase(caseId: string) {
  return useQuery({ queryKey: caseKey(caseId), queryFn: () => fetchFamilyCase(caseId), enabled: Boolean(caseId) });
}

export function useFamilyTimeline(caseId: string) {
  return useQuery({ queryKey: timelineKey(caseId), queryFn: () => fetchFamilyTimeline(caseId), enabled: Boolean(caseId) });
}

export function useFamilyDocuments(caseId: string) {
  return useQuery({ queryKey: documentsKey(caseId), queryFn: () => fetchFamilyDocuments(caseId), enabled: Boolean(caseId) });
}

export function useFamilySignatureRequests(caseId: string) {
  return useQuery({ queryKey: signatureRequestsKey(caseId), queryFn: () => fetchFamilySignatureRequests(caseId), enabled: Boolean(caseId) });
}

export function useCompleteFamilySignature(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; signedName: string }) => completeFamilySignatureRequest({ caseId, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: signatureRequestsKey(caseId) });
      queryClient.invalidateQueries({ queryKey: timelineKey(caseId) });
    },
  });
}

export function useDeclineFamilySignature(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; reason?: string }) => declineFamilySignatureRequest({ caseId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signatureRequestsKey(caseId) }),
  });
}

export function useFamilyAppointments(caseId: string) {
  return useQuery({ queryKey: appointmentsKey(caseId), queryFn: () => fetchFamilyAppointments(caseId), enabled: Boolean(caseId) });
}

export function useFamilyPayments(caseId: string) {
  return useQuery({ queryKey: paymentsKey(caseId), queryFn: () => fetchFamilyPayments(caseId), enabled: Boolean(caseId) });
}

export function useInitiateFamilyPaymentCheckout(caseId: string) {
  return useMutation({
    mutationFn: (idempotencyKey: string) => initiateFamilyPaymentCheckout({ caseId, idempotencyKey }),
  });
}

export function useFamilyPaymentStatus(caseId: string, paymentId: string | null) {
  return useQuery({
    queryKey: ['familyPaymentStatus', caseId, paymentId],
    queryFn: () => fetchFamilyPaymentStatus(caseId, paymentId as string),
    enabled: Boolean(caseId && paymentId),
  });
}

/** Mock-mode-only resolution helpers for the payments/return page —
    mirrors `hooks/useCasePayments.ts`'s own `useResolveReturnedPayment`
    shape exactly. */
export function useResolveReturnedFamilyPayment(caseId: string) {
  const queryClient = useQueryClient();

  function invalidate(paymentId: string) {
    queryClient.invalidateQueries({ queryKey: ['familyPaymentStatus', caseId, paymentId] });
    queryClient.invalidateQueries({ queryKey: paymentsKey(caseId) });
  }

  const cancel = useMutation({
    mutationFn: (paymentId: string) => cancelFamilyPayment(caseId, paymentId),
    onSuccess: (_, paymentId) => invalidate(paymentId),
  });

  const simulateSuccess = useMutation({
    mutationFn: (paymentId: string) => simulateFamilyPaymentSuccess(caseId, paymentId),
    onSuccess: (_, paymentId) => invalidate(paymentId),
  });

  return { cancel, simulateSuccess };
}

export function useFamilyMessages(caseId: string) {
  return useQuery({ queryKey: messagesKey(caseId), queryFn: () => fetchFamilyMessages(caseId), enabled: Boolean(caseId) });
}

export function useSendFamilyMessage(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendFamilyMessageRequest({ caseId, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey(caseId) }),
  });
}
