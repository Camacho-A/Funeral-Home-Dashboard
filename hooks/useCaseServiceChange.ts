import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case } from '@/types/case';
import { casesService, type CaseServiceChangeInput } from '@/services/casesService';
import { useOrganization } from './useOrganization';
import { useSession } from './useSession';
import { useWorkflowTemplates } from './useWorkflowTemplates';
import { useServiceCatalog } from './useServiceCatalog';
import { isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';

/**
 * Consistent service changes (2026-10). Previews (`confirm: false`) or
 * applies (`confirm: true`) a service-type change — workflow and case
 * order together, see services/casesService.ts#changeService. An applied
 * change refreshes the case and its order; so does a failed confirm, since
 * the server may have appended a restoring order version while undoing it.
 *
 * Phase 5A.1: a confirm is pinned to the case revision its preview was
 * computed against (`caseRevision` in the preview result). The caller need
 * not pass it: the revision of the most recent preview is remembered here
 * and sent with the confirm (falling back to the case the page holds). A
 * case changed since the preview is refused (409) — nothing is written —
 * and the case is refreshed so staff can preview again.
 */
export function useCaseServiceChange(caseId: string) {
  const organization = useOrganization();
  const session = useSession();
  const queryClient = useQueryClient();
  const enabled = isWorkflowByServiceType(organization.organizationId);
  const { data: templates } = useWorkflowTemplates({ enabled });
  const { data: catalog } = useServiceCatalog();

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['case', organization.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['caseOrder', organization.organizationId, caseId] });
  }

  const previewRevision = useRef<number | null>(null);

  return useMutation({
    mutationFn: (input: CaseServiceChangeInput) => {
      let pinned = input;
      if (input.confirm && input.expectedRevision === undefined) {
        const cached = queryClient.getQueryData<Case>(['case', organization.organizationId, caseId]);
        const revision = previewRevision.current ?? (cached ? (cached.revision ?? 0) : undefined);
        if (revision !== undefined) pinned = { ...input, expectedRevision: revision };
      }
      return casesService.changeService(organization, caseId, pinned, session, organization.dataAdapterMode, { templates, catalog });
    },
    onSuccess: (result, input) => {
      if (!input.confirm && typeof result.caseRevision === 'number') previewRevision.current = result.caseRevision;
      if (result.applied) {
        previewRevision.current = null;
        refresh();
      }
    },
    onError: (_error, input) => {
      if (input.confirm) refresh();
    },
  });
}
