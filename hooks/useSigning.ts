import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchSigningPageContext, completeSigning, declineSigning } from '@/lib/signingClient';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Query/
 * mutation hooks for the public `/sign` page — deliberately keyed only by
 * the token itself (no `organizationId`, no session), matching
 * `lib/signingClient.ts`'s own token-only surface.
 */
export function useSigningPageContext(token: string) {
  return useQuery({
    queryKey: ['signingPageContext', token],
    queryFn: () => fetchSigningPageContext(token),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useCompleteSigning(token: string) {
  return useMutation({
    mutationFn: (params: { signedName: string; initials?: string; consentAcknowledged: true }) => completeSigning(token, params),
  });
}

export function useDeclineSigning(token: string) {
  return useMutation({
    mutationFn: (params: { reason?: string }) => declineSigning(token, params),
  });
}
