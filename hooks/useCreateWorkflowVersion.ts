import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IntakeTemplate, StageTemplate } from '@/types/workflowTemplate';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { useOrganization } from './useOrganization';

/**
 * Phase 18 (Workflow Management) / Phase 19 (Configurable Intake Form
 * Builder). Saves an edited `stages` and `intake` together as one new
 * WorkflowTemplateVersion. Not optimistic — unlike Phase 17's task
 * completion toggle, there's no plausible "assume it worked" value to show
 * before the server computes the real next version number, so the editor
 * just waits on the real response (see components/settings/WorkflowEditor.tsx).
 */
export function useCreateWorkflowVersion(templateId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { stages: StageTemplate[]; intake: IntakeTemplate }) =>
      workflowTemplatesService.createVersion(organization, templateId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(['workflowTemplate', organization.organizationId, templateId], updated);
      queryClient.invalidateQueries({ queryKey: ['workflowTemplates', organization.organizationId] });
    },
  });
}
