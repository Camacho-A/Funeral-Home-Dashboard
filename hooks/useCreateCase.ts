import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isWorkflowByServiceType, selectWorkflowTemplate, TEMPLATE_SELECTION_MESSAGES } from '@/domain/workflow/serviceWorkflows';
import type { NewCaseInput } from '@/types/case';
import { casesService } from '@/services/casesService';
import { useOrganization } from './useOrganization';
import { useSession } from './useSession';
import { useWorkflowTemplates } from './useWorkflowTemplates';

/**
 * `session` (the trusted current staff member) is read here, from
 * useSession(), and passed to casesService.create as its own parameter —
 * never as part of the mutation's `input` payload. That's what keeps the
 * New Case form from ever being able to supply createdBy/intakeOwnerId
 * itself: NewCaseModal only ever builds a NewCaseInput, which has no field
 * for either.
 *
 * Phase 11: the "workflow selection logic" lives here too — the org's
 * first enabled WorkflowTemplate is resolved via useWorkflowTemplates()
 * and passed to casesService.create the same trusted way as session, so
 * workflowTemplateId/Version/workflowSnapshot are equally impossible for
 * the form to influence. Picking "first enabled" (not any particular case
 * type) is deliberately generic — Managed Cremations only has one
 * template, so this doesn't hardcode anything organization-specific; an
 * org with several enabled templates would need real selection UI, which
 * this phase doesn't build (see docs/TEMPLATE_VERSIONING.md).
 */
export function useCreateCase() {
  const organization = useOrganization();
  const session = useSession();
  const { data: templates } = useWorkflowTemplates();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewCaseInput) => {
      // Service-based workflows (2026-11): an organization that chooses
      // workflows by service gets the named service's template; every
      // other organization keeps "first enabled template" exactly.
      const selection = selectWorkflowTemplate(templates ?? [], {
        workflowByServiceType: isWorkflowByServiceType(organization.organizationId),
        serviceTypeCode: input.serviceTypeCode,
      });
      if (!selection.ok) throw new Error(TEMPLATE_SELECTION_MESSAGES[selection.reason]);
      return casesService.create(
        organization,
        { ...input, serviceTypeCode: selection.serviceTypeCode },
        session,
        selection.template,
        organization.dataAdapterMode,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
    },
  });
}
