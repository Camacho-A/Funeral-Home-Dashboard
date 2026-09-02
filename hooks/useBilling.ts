import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchStatementPreview,
  generateStatement,
  fetchCashAdvances,
  createCashAdvance,
  deleteCashAdvance,
  fetchPriceLists,
  generatePriceList,
} from '@/lib/billingClient';

/**
 * Phase 39 (Family Billing & FTC Compliance). Query/mutation hooks for the
 * case Billing panel and the Settings price-list section.
 */
const statementPreviewKey = (caseId: string) => ['billingStatementPreview', caseId];
const cashAdvancesKey = (caseId: string) => ['billingCashAdvances', caseId];
const priceListsKey = (organizationId: string) => ['billingPriceLists', organizationId];
const caseDocumentsPrefix = (caseId: string) => ['caseDocuments', caseId];

export function useStatementPreview(organizationId: string, caseId: string) {
  return useQuery({
    queryKey: statementPreviewKey(caseId),
    queryFn: () => fetchStatementPreview(organizationId, caseId),
    enabled: Boolean(organizationId && caseId),
    retry: false,
  });
}

export function useCashAdvances(organizationId: string, caseId: string) {
  return useQuery({
    queryKey: cashAdvancesKey(caseId),
    queryFn: () => fetchCashAdvances(organizationId, caseId),
    enabled: Boolean(organizationId && caseId),
  });
}

export function useCreateCashAdvance(organizationId: string, caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { description: string; amountCents: number; hasMarkup: boolean; isEstimated: boolean }) =>
      createCashAdvance({ organizationId, caseId, ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cashAdvancesKey(caseId) });
      qc.invalidateQueries({ queryKey: statementPreviewKey(caseId) });
    },
  });
}

export function useDeleteCashAdvance(organizationId: string, caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deleteCashAdvance(organizationId, caseId, itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cashAdvancesKey(caseId) });
      qc.invalidateQueries({ queryKey: statementPreviewKey(caseId) });
    },
  });
}

export function useGenerateStatement(organizationId: string, caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { existingDocumentId?: string; requiredPurchaseExplanations?: string | null }) =>
      generateStatement({ organizationId, caseId, ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: caseDocumentsPrefix(caseId) });
    },
  });
}

export function usePriceLists(organizationId: string) {
  return useQuery({ queryKey: priceListsKey(organizationId), queryFn: () => fetchPriceLists(organizationId), enabled: Boolean(organizationId) });
}

export function useGeneratePriceList(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (effectiveDate: string) => generatePriceList({ organizationId, effectiveDate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: priceListsKey(organizationId) }),
  });
}
