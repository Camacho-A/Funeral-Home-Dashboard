import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCremationLabelState, fetchSavedCremationLabel, saveCremationLabel } from '@/lib/caseLabelClient';
import { caseDocumentsKey } from './useCaseDocumentLibrary';

/** Cremation Label (2026-10). The case's label state and its saved versions. */
export const cremationLabelKey = (organizationId: string, caseId: string) => ['cremationLabel', organizationId, caseId];

export function useCremationLabelState(organizationId: string, caseId: string, enabled: boolean) {
  return useQuery({
    queryKey: cremationLabelKey(organizationId, caseId),
    queryFn: () => fetchCremationLabelState(organizationId, caseId),
    enabled: enabled && Boolean(organizationId && caseId),
    staleTime: 0,
  });
}

/** One saved version exactly as stored. Never changes once saved, so it
    is cached for the session. */
export function useSavedCremationLabel(organizationId: string, caseId: string, documentId: string | null) {
  return useQuery({
    queryKey: [...cremationLabelKey(organizationId, caseId), 'saved', documentId],
    queryFn: () => fetchSavedCremationLabel(organizationId, caseId, documentId!),
    enabled: Boolean(organizationId && caseId && documentId),
    staleTime: Infinity,
  });
}

export function useSaveCremationLabel(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expectedLatestDocumentId: string | null) => saveCremationLabel(organizationId, caseId, expectedLatestDocumentId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: cremationLabelKey(organizationId, caseId) }),
        queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) }),
      ]),
  });
}
