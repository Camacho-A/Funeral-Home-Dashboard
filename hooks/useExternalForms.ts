import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCaseForms,
  generateFormLink,
  fetchUnmatchedSubmissions,
  linkSubmissionToCase,
  fetchReconciliation,
  applyReconciliation,
  previewHistoricalImport,
  importHistoricalSubmission,
  fetchExternalFormConfigs,
  previewHistoricalCase,
  createHistoricalCase,
  retryFormPdf,
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
    // Case progression fix (2026-09): linking a submission can advance the
    // target case's rawStage server-side (reconcileCaseWorkflow) — without
    // also invalidating its own case query, a Case Detail page already
    // open for that case (e.g. in another tab) would keep showing its
    // stale, pre-reconciliation stage/checklist until an unrelated
    // remount/refocus happened to refetch it.
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: unmatchedSubmissionsKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: ['case', organizationId, variables.caseId] });
    },
  });
}

export function useReconciliation(organizationId: string, submissionId: string, caseId: string, enabled: boolean) {
  return useQuery({
    queryKey: reconciliationKey(organizationId, submissionId, caseId),
    queryFn: () => fetchReconciliation(organizationId, submissionId, caseId),
    enabled: enabled && Boolean(organizationId) && Boolean(submissionId) && Boolean(caseId),
  });
}

/** Case repair UI (2026-09) — "Retry Jotform PDF." Reuses the already-
    deployed retry-pdf endpoint; the submission id always comes from an
    existing CaseFormRow, never user-entered. Refreshes both Forms (so the
    row's pdfStatus/documentId reflect the outcome) and Documents (so a
    newly-stored PDF appears immediately) on success. */
export function useRetryFormPdf(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (submissionId: string) => retryFormPdf(organizationId, submissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: caseFormsKey(organizationId, caseId) });
      queryClient.invalidateQueries({ queryKey: ['caseDocuments', organizationId, caseId] });
    },
  });
}

export function useApplyReconciliation(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { submissionId: string; fieldsToApply: string[] }) =>
      applyReconciliation(organizationId, params.submissionId, caseId, params.fieldsToApply),
    // Case progression fix (2026-09): applying reconciled fields (and/or
    // marking the submission's CaseFormLink reviewed) can advance this
    // case's rawStage server-side — this is rendered on the SAME Case
    // Detail page (CaseFormsSection -> ReconciliationModal), so without
    // this invalidation the page you're looking at would keep showing the
    // pre-reconciliation stage/checklist even though the persisted record
    // already advanced.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: caseFormsKey(organizationId, caseId) });
      queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] });
    },
  });
}

/** Historical-submission ingestion (2026-09) — on-demand lookup triggered
    by user input (a pasted Jotform submission id), not a cacheable
    mount-time query. */
export function usePreviewHistoricalImport(organizationId: string, caseId: string) {
  return useMutation({
    mutationFn: (params: { formConfigId: string; externalSubmissionId: string }) =>
      previewHistoricalImport(organizationId, caseId, params.formConfigId, params.externalSubmissionId),
  });
}

export function useImportHistoricalSubmission(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { formConfigId: string; externalSubmissionId: string }) =>
      importHistoricalSubmission(organizationId, caseId, params.formConfigId, params.externalSubmissionId),
    // Case progression fix (2026-09): importing a historical submission
    // links the Arrangement Form and advances rawStage server-side
    // (reconcileCaseWorkflow) — this action is triggered right from this
    // case's own Case Detail page (CaseFormsSection), so without this
    // invalidation the already-mounted case query would keep serving its
    // stale, pre-reconciliation stage/checklist.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: caseFormsKey(organizationId, caseId) });
      queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] });
    },
  });
}

/** Historical CASE creation (2026-09) — no existing case to scope to, so
    this reads the organization's configs directly rather than via
    useCaseForms. */
export function useExternalFormConfigs(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['externalFormConfigs', organizationId],
    queryFn: () => fetchExternalFormConfigs(organizationId),
    enabled: enabled && Boolean(organizationId),
  });
}

export function usePreviewHistoricalCase(organizationId: string) {
  return useMutation({
    mutationFn: (params: { formConfigId: string; externalSubmissionId: string }) =>
      previewHistoricalCase(organizationId, params.formConfigId, params.externalSubmissionId),
  });
}

/** Task #20 (2026-09, close import window after success): this mutation
    previously had no onSuccess at all — a genuinely new case was created
    server-side, but the Cases list query was never invalidated, so it
    wouldn't appear without a manual browser refresh. Only invalidates
    when a new case was actually created (`!alreadyImported`) — the
    duplicate-protection no-op path changes nothing, so there's nothing to
    refetch. */
export function useCreateHistoricalCase(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { formConfigId: string; externalSubmissionId: string; nextOfKinName: string; nextOfKinPhone: string }) =>
      createHistoricalCase(organizationId, params.formConfigId, params.externalSubmissionId, params.nextOfKinName, params.nextOfKinPhone),
    onSuccess: (outcome) => {
      if (!outcome.alreadyImported) {
        queryClient.invalidateQueries({ queryKey: ['cases', organizationId] });
      }
    },
  });
}
