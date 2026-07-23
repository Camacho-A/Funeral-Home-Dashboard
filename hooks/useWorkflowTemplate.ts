import { useQuery } from '@tanstack/react-query';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { useOrganization } from './useOrganization';

/**
 * Phase 18 (Workflow Management). One workflow template with its full
 * version history, for the Settings page's editor — same shape as
 * useCase.ts (a plain id in, never a route param directly), paired with
 * useWorkflowTemplates() (Phase 15B, list) exactly the way useCase pairs
 * with useCases.
 */
export function useWorkflowTemplate(templateId: string) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['workflowTemplate', organization.organizationId, templateId],
    queryFn: () => workflowTemplatesService.get(organization, templateId),
    enabled: Boolean(templateId),
  });
}
