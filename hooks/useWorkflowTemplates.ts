import { useQuery } from '@tanstack/react-query';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { useOrganization } from './useOrganization';

/** `enabled` (2026-10) lets a surface that only needs templates for an
    organization with service-specific workflows skip the request
    entirely for everyone else. Defaults to true (unchanged). */
export function useWorkflowTemplates(options: { enabled?: boolean } = {}) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['workflowTemplates', organization.organizationId],
    queryFn: () => workflowTemplatesService.list(organization),
    enabled: options.enabled ?? true,
  });
}
