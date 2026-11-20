import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PreparationChange } from '@/domain/servicePreparation/preparationUpdates';
import type { ServicePreparationView } from '@/services/servicePreparationService';
import type { CallerReleaseView, ReleaseAction } from '@/services/cremationReleaseService';
import type { MedicalExaminerApprovalView } from '@/services/medicalExaminerApprovalService';

/**
 * Service preparation (Gus Phase 5C). Reads and saves through
 * /api/cases/[caseId]/service-preparation in every data mode, so what is
 * saved is what comes back after a refresh. On a 409 the server's latest
 * preparation replaces what is shown.
 */
export type ServicePreparationResponse = {
  preparation: ServicePreparationView;
  canEdit: boolean;
  release: CallerReleaseView | null;
  /** Gus Phase 5G: the recorded ME cremation approval, when this organization records it. */
  medicalExaminer?: MedicalExaminerApprovalView | null;
};

export class ServicePreparationSaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const servicePreparationKey = (organizationId: string, caseId: string) => ['servicePreparation', organizationId, caseId];

async function fetchServicePreparation(organizationId: string, caseId: string): Promise<ServicePreparationResponse | null> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/service-preparation?${new URLSearchParams({ organizationId })}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Could not load the service preparation.');
  return body as ServicePreparationResponse;
}

export function useServicePreparation(organizationId: string, caseId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const key = servicePreparationKey(organizationId, caseId);
  const query = useQuery({ queryKey: key, queryFn: () => fetchServicePreparation(organizationId, caseId), enabled: enabled && Boolean(organizationId && caseId) });

  const save = useMutation({
    mutationFn: async (input: { change: PreparationChange; basisAt: string | null; reason?: string }) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/service-preparation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, change: input.change, basis: { at: input.basisAt }, ...(input.reason ? { reason: input.reason } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.preparation) {
          queryClient.setQueryData<ServicePreparationResponse | null>(key, (old) => (old ? { ...old, preparation: body.preparation } : old));
        }
        throw new ServicePreparationSaveError(body.error ?? 'Could not save. Please try again.', response.status);
      }
      return body.preparation as ServicePreparationView;
    },
    onSuccess: (preparation) => {
      queryClient.setQueryData<ServicePreparationResponse | null>(key, (old) => (old ? { ...old, preparation } : old));
      queryClient.invalidateQueries({ queryKey: ['activityEvents'] });
    },
  });

  // Gus Phase 5G: record (or correct) the ME cremation approval. The
  // release check is re-read afterwards, so it reflects the new record.
  const recordMedicalExaminer = useMutation({
    mutationFn: async (input: { confirmedInEdrs: boolean; approvalDate: string; reference: string; evidenceDocumentId: string | null; evidenceSource: string | null; reason: string | null }) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/medical-examiner-approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, ...input }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new ServicePreparationSaveError(body.error ?? 'Could not record the approval.', response.status);
      return body.medicalExaminer as MedicalExaminerApprovalView;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['activityEvents'] });
    },
  });

  // Gus Phase 5K: release for cremation (refused by the server while inactive).
  const releaseForCremation = useMutation({
    mutationFn: async (input: { action: ReleaseAction; reason?: string; correctsEventId?: string } = { action: 'release' }) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/cremation-release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, confirm: true, action: input.action,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.correctsEventId !== undefined ? { correctsEventId: input.correctsEventId } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new ServicePreparationSaveError(body.error ?? 'Could not release. Nothing was released.', response.status);
      return body;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['activityEvents'] });
    },
  });

  return { query, save, recordMedicalExaminer, releaseForCremation };
}
