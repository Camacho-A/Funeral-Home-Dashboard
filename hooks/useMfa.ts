import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMfaStatus, beginMfa, verifyMfa, disableMfa, regenerateRecoveryCodes, fetchOrgMfaPolicy, setOrgMfaPolicy } from '@/lib/mfaClient';

/**
 * Phase 40 (MFA & Account Security). Query/mutation hooks for the account MFA
 * management UI and the org require-MFA policy toggle.
 */
const statusKey = ['mfaStatus'];
const orgPolicyKey = (organizationId: string) => ['mfaOrgPolicy', organizationId];

export function useMfaStatus() {
  return useQuery({ queryKey: statusKey, queryFn: fetchMfaStatus, retry: false });
}

export function useBeginMfa() {
  return useMutation({ mutationFn: beginMfa });
}

export function useVerifyMfa() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => verifyMfa(code), onSuccess: () => qc.invalidateQueries({ queryKey: statusKey }) });
}

export function useDisableMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { code: string; useRecoveryCode?: boolean }) => disableMfa(params.code, params.useRecoveryCode),
    onSuccess: () => qc.invalidateQueries({ queryKey: statusKey }),
  });
}

export function useRegenerateRecoveryCodes() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => regenerateRecoveryCodes(code), onSuccess: () => qc.invalidateQueries({ queryKey: statusKey }) });
}

export function useOrgMfaPolicy(organizationId: string) {
  return useQuery({ queryKey: orgPolicyKey(organizationId), queryFn: () => fetchOrgMfaPolicy(organizationId), enabled: Boolean(organizationId), retry: false });
}

export function useSetOrgMfaPolicy(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requireMfa: boolean) => setOrgMfaPolicy(organizationId, requireMfa),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgPolicyKey(organizationId) }),
  });
}
