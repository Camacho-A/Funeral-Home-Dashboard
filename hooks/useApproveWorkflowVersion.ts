import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import type { WorkflowApprovalAttestation } from '@/types/workflowTemplate';
import { useOrganization } from './useOrganization';

/**
 * Service-specific workflows (2026-10). Approves a draft workflow template
 * version (Settings › Workflow Templates). Mirrors
 * useCreateWorkflowVersion's cache handling.
 *
 * Unfinished-workflow protection (2026-10): takes the approver's review
 * attestation with the version — `{ version, attestation }` — which the
 * route requires. A bare version number is still accepted (and refused by
 * the route with 422, as an approval without an attestation).
 */
export function useApproveWorkflowVersion(templateId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: number | { version: number; attestation: WorkflowApprovalAttestation }) =>
      typeof input === 'number'
        ? workflowTemplatesService.approveVersion(organization, templateId, input)
        : workflowTemplatesService.approveVersion(organization, templateId, input.version, input.attestation),
    onSuccess: (updated) => {
      queryClient.setQueryData(['workflowTemplate', organization.organizationId, templateId], updated);
      queryClient.invalidateQueries({ queryKey: ['workflowTemplates', organization.organizationId] });
    },
  });
}
