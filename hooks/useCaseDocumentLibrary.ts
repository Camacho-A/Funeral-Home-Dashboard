import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCaseDocuments, generateCaseDocument, uploadCaseDocument, archiveCaseDocument } from '@/lib/caseDocumentsClient';

/**
 * Phase 25 (Document Generation & Template Management). Query/mutation
 * hooks for the Case Detail Documents tab's real, persisted document
 * system — deliberately a new file/name (not `hooks/useCaseDocuments.ts`,
 * which stays exactly as it is, backing the Overview tab's pre-existing
 * mock-only `DocumentsCard`, kept for rollback safety per this phase's own
 * decision, mirroring Phase 24's `ActivityLogCard` precedent exactly).
 */
const caseDocumentsKey = (organizationId: string, caseId: string) => ['caseDocumentLibrary', organizationId, caseId];

export function useCaseDocumentLibrary(organizationId: string, caseId: string) {
  return useQuery({
    queryKey: caseDocumentsKey(organizationId, caseId),
    queryFn: () => fetchCaseDocuments(organizationId, caseId),
    enabled: Boolean(organizationId && caseId),
  });
}

export function useGenerateCaseDocument(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { templateId: string; templateVersion?: number; existingDocumentId?: string }) =>
      generateCaseDocument({ organizationId, caseId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) }),
  });
}

export function useUploadCaseDocument(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { file: File; documentTypeKey?: string; category?: string }) => uploadCaseDocument({ organizationId, caseId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) }),
  });
}

export function useArchiveCaseDocument(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => archiveCaseDocument({ organizationId, caseId, documentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) }),
  });
}
