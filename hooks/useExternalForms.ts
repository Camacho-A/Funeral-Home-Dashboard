import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCaseForms,
  generateFormLink,
  fetchUnmatchedSubmissions,
  linkSubmissionToCase,
  fetchReconciliation,
  applyReconciliation,
} from '@/lib/externalFormsClient';

/** Manors Jotform integration (case-first architecture, 2026-09). */

const caseFormsKey = (organizationId: string, caseId: string) => ['caseForms', organizationId, caseId];
const unmatchedSubmissionsKey = (organizationId: string) => ['unmatchedExternalFormSubmissions', organizationId];
const reconciliationKey = (organizationId: string, submissionId: string, caseId: string) => ['externalFormReconciliation', organizationId, submissionId, caseId];

export function useCaseForms(organizationId: string, caseId: string) {
  return useQuery({
    queryKey: caseFormsKey(organizationId, caseId),
    queryFn: () => fetchCaseForms(organizationId, caseId),
    enabled: Boolean(organizationId) && Boolean(caseId),
  });
}

export function useGenerateFormLink(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formConfigId: string) => generateFormLink(organizationId, caseId, formConfigId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: caseFormsKey(organizationId, caseId) }),
  });
}

export function useUnmatchedSubmissions(organizationId: string) {
  return useQuery({
    queryKey: unmatchedSubmissionsKey(organizationId),
    queryFn: () => fetchUnmatchedSubmissions(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useLinkSubmissionToCase(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { submissionId: string; caseId: string }) => linkSubmissionToCase(organizationId, params.submissionId, params.caseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: unmatchedSubmissionsKey(organizationId) }),
  });
}

export function useReconciliation(organizationId: string, submissionId: string, caseId: string, enabled: boolean) {
  return useQuery({
    queryKey: reconciliationKey(organizationId, submissionId, caseId),
    queryFn: () => fetchReconciliation(organizationId, submissionId, caseId),
    enabled: enabled && Boolean(organizationId) && Boolean(submissionId) && Boolean(caseId),
  });
}

export function useApplyReconciliation(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { submissionId: string; fieldsToApply: string[] }) =>
      applyReconciliation(organizationId, params.submissionId, caseId, params.fieldsToApply),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: caseFormsKey(organizationId, caseId) }),
  });
}
