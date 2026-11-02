import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case } from '@/types/case';
import { casesService, type CaseWorkflowChangeInput } from '@/services/casesService';
import { useOrganization } from './useOrganization';
import { useSession } from './useSession';
import { useWorkflowTemplates } from './useWorkflowTemplates';
import { isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';

/**
 * Service-specific workflows (2026-10). Previews (`confirm: false`) or
 * applies (`confirm: true`) the workflow change a service-type change
 * implies — see services/casesService.ts#changeWorkflow. Only an applied
 * change invalidates the case caches; a preview never writes anything.
 *
 * Phase 5A.1: a confirm is pinned to the case revision of the most recent
 * preview (falling back to the case the page holds); a case changed since
 * is refused (409) and nothing is written.
 */
export function useCaseWorkflowChange(caseId: string) {
  const organization = useOrganization();
  const session = useSession();
  const queryClient = useQueryClient();
  const { data: templates } = useWorkflowTemplates({ enabled: isWorkflowByServiceType(organization.organizationId) });

  const previewRevision = useRef<number | null>(null);

  return useMutation({
    mutationFn: (input: CaseWorkflowChangeInput) => {
      let pinned = input;
      if (input.confirm && input.expectedRevision === undefined) {
        const cached = queryClient.getQueryData<Case>(['case', organization.organizationId, caseId]);
        const revision = previewRevision.current ?? (cached ? (cached.revision ?? 0) : undefined);
        if (revision !== undefined) pinned = { ...input, expectedRevision: revision };
      }
      return casesService.changeWorkflow(organization, caseId, pinned, session, organization.dataAdapterMode, { templates });
    },
    onSuccess: (result, input) => {
      if (!input.confirm && typeof result.caseRevision === 'number') previewRevision.current = result.caseRevision;
      if (!result.applied) return;
      previewRevision.current = null;
      queryClient.invalidateQueries({ queryKey: ['case', organization.organizationId] });
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
    },
  });
}
