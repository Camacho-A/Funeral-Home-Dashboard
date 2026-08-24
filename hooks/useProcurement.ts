import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSuppliers, createSupplierRequest, archiveSupplierRequest, type CreateSupplierInput,
  fetchPurchaseOrders, createPurchaseOrderRequest, submitPurchaseOrderRequest, cancelPurchaseOrderRequest, closePurchaseOrderRequest, type CreatePurchaseOrderInput,
  fetchBills, createBillRequest, voidBillRequest, recordPaymentRequest, type CreateBillInput, type RecordPaymentInput,
} from '@/lib/procurementClient';

/**
 * Phase 36 (Procurement & Accounts Payable). Query/mutation hooks for the
 * Settings → Suppliers, Purchase Orders, and Accounts Payable pages —
 * bundled the same way hooks/useMerchandise.ts bundles its own set.
 */
export function useSuppliers(organizationId: string, includeInactive = false) {
  return useQuery({ queryKey: ['suppliers', organizationId, includeInactive], queryFn: () => fetchSuppliers(organizationId, includeInactive), enabled: Boolean(organizationId) });
}
export function useCreateSupplier(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateSupplierInput) => createSupplierRequest(input), onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers', organizationId] }) });
}
export function useArchiveSupplier(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (supplierId: string) => archiveSupplierRequest(organizationId, supplierId), onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers', organizationId] }) });
}

export function usePurchaseOrders(organizationId: string) {
  return useQuery({ queryKey: ['purchaseOrders', organizationId], queryFn: () => fetchPurchaseOrders(organizationId), enabled: Boolean(organizationId) });
}
export function useCreatePurchaseOrder(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreatePurchaseOrderInput) => createPurchaseOrderRequest(input), onSuccess: () => qc.invalidateQueries({ queryKey: ['purchaseOrders', organizationId] }) });
}
export function usePurchaseOrderAction(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ purchaseOrderId, action }: { purchaseOrderId: string; action: 'submit' | 'close' | 'cancel' }) =>
      action === 'submit' ? submitPurchaseOrderRequest(organizationId, purchaseOrderId) : action === 'close' ? closePurchaseOrderRequest(organizationId, purchaseOrderId) : cancelPurchaseOrderRequest(organizationId, purchaseOrderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchaseOrders', organizationId] }),
  });
}

export function useBills(organizationId: string) {
  return useQuery({ queryKey: ['vendorBills', organizationId], queryFn: () => fetchBills(organizationId), enabled: Boolean(organizationId) });
}
export function useCreateBill(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateBillInput) => createBillRequest(input), onSuccess: () => qc.invalidateQueries({ queryKey: ['vendorBills', organizationId] }) });
}
export function useVoidBill(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ billId, reason }: { billId: string; reason?: string }) => voidBillRequest(organizationId, billId, reason), onSuccess: () => qc.invalidateQueries({ queryKey: ['vendorBills', organizationId] }) });
}
export function useRecordPayment(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ billId, input }: { billId: string; input: RecordPaymentInput }) => recordPaymentRequest(billId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['vendorBills', organizationId] }) });
}
