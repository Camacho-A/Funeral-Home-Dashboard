import { useQuery } from '@tanstack/react-query';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { useOrganization } from './useOrganization';

export function useWorkflowTemplates() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['workflowTemplates', organization.organizationId],
    queryFn: () => workflowTemplatesService.list(organization),
  });
}
