import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StageTemplate } from '@/types/workflowTemplate';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { useOrganization } from './useOrganization';

/**
 * Phase 18 (Workflow Management). Saves an edited stages array as a new
 * WorkflowTemplateVersion. Not optimistic — unlike Phase 17's task
 * completion toggle, there's no plausible "assume it worked" value to show
 * before the server computes the real next version number, so the editor
 * just waits on the real response (see components/settings/WorkflowEditor.tsx).
 */
export function useCreateWorkflowVersion(templateId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (stages: StageTemplate[]) => workflowTemplatesService.createVersion(organization, templateId, stages),
    onSuccess: (updated) => {
      queryClient.setQueryData(['workflowTemplate', organization.organizationId, templateId], updated);
      queryClient.invalidateQueries({ queryKey: ['workflowTemplates', organization.organizationId] });
    },
  });
}
