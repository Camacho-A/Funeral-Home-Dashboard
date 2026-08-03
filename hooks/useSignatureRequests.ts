import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSignatureRequests, createSignatureRequest, resendSignatureRequest, cancelSignatureRequest } from '@/lib/signatureRequestsClient';
import type { SignerRole } from '@/types/signatureRequest';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Query/
 * mutation hooks for the Documents tab's Signature Status panel — same
 * shape as `hooks/useCaseDocumentLibrary.ts`.
 */
const signatureRequestsKey = (organizationId: string, caseId: string, documentId: string) => ['signatureRequests', organizationId, caseId, documentId];

export function useSignatureRequestsForDocument(organizationId: string, caseId: string, documentId: string) {
  return useQuery({
    queryKey: signatureRequestsKey(organizationId, caseId, documentId),
    queryFn: () => fetchSignatureRequests(organizationId, caseId, documentId),
    enabled: Boolean(organizationId && caseId && documentId),
  });
}

export function useCreateSignatureRequest(organizationId: string, caseId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { signerName: string; signerEmail: string; signerRole: SignerRole; expiresAt?: string }) =>
      createSignatureRequest({ organizationId, caseId, documentId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signatureRequestsKey(organizationId, caseId, documentId) }),
  });
}

export function useResendSignatureRequest(organizationId: string, caseId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => resendSignatureRequest({ organizationId, caseId, documentId, requestId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signatureRequestsKey(organizationId, caseId, documentId) }),
  });
}

export function useCancelSignatureRequest(organizationId: string, caseId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => cancelSignatureRequest({ organizationId, caseId, documentId, requestId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signatureRequestsKey(organizationId, caseId, documentId) }),
  });
}
