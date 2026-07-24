import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServiceSelections } from '@/types/caseOrder';
import { pricingClient } from '@/services/pricingClient';
import { useOrganization } from './useOrganization';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Same
 * organization-scoped query-key convention as useCasePayments. Both
 * mutations invalidate this case's order query (and, since a CaseOrder
 * edit/creation can move balanceDue, the case's own payment history query
 * too — a fresh Case Order affects what "Collect Balance with Clover"
 * will charge next).
 */
export function useCaseOrder(caseId: string) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['caseOrder', organization.organizationId, caseId],
    queryFn: () => pricingClient.getCaseOrder(organization, caseId),
  });
}

export function useCreateCaseOrder(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { selections: ServiceSelections; performedBy: string }) =>
      pricingClient.createCaseOrder(organization, caseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caseOrder', organization.organizationId, caseId] });
    },
  });
}

export function useEditCaseOrder(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { selections: ServiceSelections; performedBy: string }) =>
      pricingClient.editCaseOrder(organization, caseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caseOrder', organization.organizationId, caseId] });
    },
  });
}
