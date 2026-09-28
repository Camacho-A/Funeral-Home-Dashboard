import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCaseDocuments,
  generateCaseDocument,
  uploadCaseDocument,
  archiveCaseDocument,
  setCaseDocumentFamilyVisibility,
  fetchBulkDownloadZip,
  fetchBulkPrintPdf,
} from '@/lib/caseDocumentsClient';
import { printFile } from '@/utils/print';

/**
 * Phase 25 (Document Generation & Template Management). Query/mutation
 * hooks for the Case Detail Documents tab's real, persisted document
 * system — deliberately a new file/name (not `hooks/useCaseDocuments.ts`,
 * which stays exactly as it is, backing the Overview tab's pre-existing
 * mock-only `DocumentsCard`, kept for rollback safety per this phase's own
 * decision, mirroring Phase 24's `ActivityLogCard` precedent exactly).
 */
/** Exported so any other mutation that changes this case's document list —
    e.g. useBilling.ts's Statement generation — invalidates the exact same
    cache entry the real Documents tab reads, rather than a second,
    independently-typed key that can drift out of sync with this one. */
export const caseDocumentsKey = (organizationId: string, caseId: string) => ['caseDocumentLibrary', organizationId, caseId];

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

/** Phase 29 (Family Portal & External Collaboration). Backs the Family
    Portal tab's document-visibility toggle — invalidates the same cache
    entry as every other document mutation above, so the Documents tab
    reflects a `familyVisible` change made from the Family Portal tab. */
export function useSetCaseDocumentFamilyVisibility(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { documentId: string; familyVisible: boolean }) => setCaseDocumentFamilyVisibility({ organizationId, caseId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) }),
  });
}

/** Task #3 (2026-09) — "Download All." Fetches the on-demand ZIP (never a
    persisted CaseDocument — see documentService.ts#buildBulkDownloadZip)
    and triggers a normal browser file save via a synthetic, immediately-
    revoked object-URL anchor click — the same client-side-only mechanism
    `printFile`'s real-file branch already uses for a local upload, just
    aimed at a save instead of a print. Returns `excluded` so the caller
    can show a partial-failure warning. No mutation state to invalidate —
    this never changes the document list. */
export function useBulkDownloadCaseDocuments(organizationId: string, caseId: string) {
  return useMutation({
    mutationFn: async () => {
      const { blob, fileName, excluded } = await fetchBulkDownloadZip(organizationId, caseId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return { excluded };
    },
  });
}

/** Task #3 (2026-09) — "Print All." Fetches the on-demand combined PDF
    (never a persisted CaseDocument — see
    documentService.ts#buildBulkPrintPdf) and prints it through the exact
    same `printFile` utility individual Print already uses. Returns
    `excluded` so the caller can show a partial-failure warning (e.g. a
    DOCX upload that could not be included in the combined PDF). */
export function useBulkPrintCaseDocuments(organizationId: string, caseId: string, caseName: string, caseNumber: string) {
  return useMutation({
    mutationFn: async () => {
      const { blob, excluded } = await fetchBulkPrintPdf(organizationId, caseId);
      printFile(blob, 'All Documents', caseName, caseNumber);
      return { excluded };
    },
  });
}
