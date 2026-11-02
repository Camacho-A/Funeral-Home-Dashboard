'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ServicesAndChargesSelector, type ServicesAndChargesSelectorHandle } from '@/components/case/ServicesAndChargesSelector';
import { useCatalogCategories, useServiceCatalog } from '@/hooks/useServiceCatalog';
import { useCreateCaseOrder, useEditCaseOrder } from '@/hooks/useCaseOrder';
import { isOrderLinePriceLocked, pricingPermissionFor } from '@/domain/pricing/pricingPermissions';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { selectionsFromLineItems, customItemSelectionsFromLineItems, calculateOrderTotals, catalogWithOrderSnapshots } from '@/domain/pricing/calculateOrder';
import { additionalItemsLabel, usesAdditionalItemsTerminology, ADDITIONAL_ITEMS_SUPPORTING_TEXT } from '@/domain/organization/caseOrderTerminology';
import type { CaseOrder, CaseOrderLineItem, ServiceSelections, CustomLineItemSelection } from '@/types/caseOrder';
import { isCaseOrderChangedError } from '@/services/pricingClient';
import { useCase } from '@/hooks/useCase';
import { useCaseServiceChange } from '@/hooks/useCaseServiceChange';
import { isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import type { WorkflowChangePreview } from '@/domain/workflow/planCaseWorkflowChange';
import type { ServiceChangeOrderPreview } from '@/services/caseServiceChangeService';
import { WorkflowChangeConfirmation } from '@/components/case/WorkflowChangeConfirmation';
import styles from './EditServicesModal.module.css';

/** One per previewed service change (see handleSave). */
function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `svc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const DEFAULT_SELECTIONS: ServiceSelections = {
  weightTier: 'under_200',
  extraDeathCertificateQuantity: 0,
  mailCremated: false,
  keepsakeTransferQuantity: 0,
  urnTransfer: false,
  shipping: false,
};

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). One modal
 * serves both "set up services for the first time" (no active CaseOrder
 * yet — a case created before this phase, or one whose initial order
 * creation failed post-case-creation) and "Edit Services" (an active
 * order already exists) — the only difference is which mutation runs on
 * submit and what the selector starts prefilled with. Every edit produces
 * a brand-new CaseOrder version server-side and appends audit entries
 * (services/pricingService.ts's recalculateOrder) — never a client-side
 * diff or total; this modal only ever submits *selections*.
 */
export function EditServicesModal({
  caseId,
  order,
  lineItems,
  open,
  onClose,
}: {
  caseId: string;
  order: CaseOrder | null;
  lineItems: CaseOrderLineItem[];
  open: boolean;
  onClose: () => void;
}) {
  const { organizationId } = useOrganization();
  // Gus Phase 5C-3 (finalization): custom (one-off, staff-priced) items are
  // added, changed or removed only by an Administrator or Manager
  // (serviceCatalog.edit); everyone else sees them read-only. The server
  // enforces this on every order write.
  const { data: myPermissions } = useMyPermissions(organizationId);
  // Custom items: the organization's pricing permission model decides
  // (caseOrder.customItems, or caseOrder.update on the legacy model).
  const customItemsKey = pricingPermissionFor(organizationId, 'order.customItems');
  const canEditCustomItems = customItemsKey !== null && (myPermissions?.permissions ?? []).includes(customItemsKey);
  const { data: liveCatalog = [] } = useServiceCatalog();
  const { data: categories } = useCatalogCategories();
  // Gus Phase 5C-3: an existing order's lines keep the prices they were
  // saved with — the preview prices against the same snapshot-aware
  // catalog the server recalculates with.
  const catalog = useMemo(() => (order && isOrderLinePriceLocked(organizationId) ? catalogWithOrderSnapshots(liveCatalog, lineItems) : liveCatalog), [order, organizationId, liveCatalog, lineItems]);
  const createOrder = useCreateCaseOrder(caseId);
  const editOrder = useEditCaseOrder(caseId);

  const initialSelections = order ? selectionsFromLineItems(lineItems) : DEFAULT_SELECTIONS;
  const [selections, setSelections] = useState<ServiceSelections>(initialSelections);
  // SOLIS cleanup item #11 (2026-09). Custom items round-trip through the
  // same order-selections model as services/merchandise — seeded from this
  // case's own current line items, never a permanent catalog.
  const [customItems, setCustomItems] = useState<CustomLineItemSelection[]>(
    order ? customItemSelectionsFromLineItems(lineItems) : [],
  );
  const selectorRef = useRef<ServicesAndChargesSelectorHandle>(null);

  // Service-specific workflows (2026-10). For an organization whose
  // workflow follows the service type, choosing a different service may
  // move the case onto another workflow. That is never applied silently:
  // Save first asks the server for a preview, staff review it in
  // WorkflowChangeConfirmation, and only "Confirm workflow change" applies
  // it. Every other organization never reaches any of this.
  //
  // Consistent service changes (2026-10): preview and confirm both go
  // through ONE coordinated operation (POST .../service-change) that
  // changes the workflow and the case order together or not at all — no
  // longer a workflow save followed by a separate order save. The
  // idempotency key is minted per preview and reused if staff retry the
  // confirm, so a retried request never applies twice. An edit that
  // doesn't change the service type keeps the plain order save.
  const byServiceType = isWorkflowByServiceType(organizationId);
  const { data: currentCase } = useCase(caseId, { enabled: byServiceType && open });
  const serviceChange = useCaseServiceChange(caseId);
  const [workflowPreview, setWorkflowPreview] = useState<WorkflowChangePreview | null>(null);
  const [orderChangePreview, setOrderChangePreview] = useState<ServiceChangeOrderPreview | null>(null);
  const [serviceChangeKey, setServiceChangeKey] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const currentServiceTypeCode = currentCase?.workflowSnapshot?.serviceTypeCode ?? null;
  const serviceChanged =
    byServiceType &&
    Boolean(currentCase) &&
    typeof selections.serviceTypeCode === 'string' &&
    selections.serviceTypeCode !== currentServiceTypeCode;

  // Re-seed the draft from the current order every time the modal opens —
  // never carry a stale draft from a previous open across into a fresh one.
  useEffect(() => {
    if (open) {
      setSelections(order ? selectionsFromLineItems(lineItems) : DEFAULT_SELECTIONS);
      setCustomItems(order ? customItemSelectionsFromLineItems(lineItems) : []);
      setWorkflowPreview(null);
      setOrderChangePreview(null);
      setServiceChangeKey(null);
      setWorkflowError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Non-destructive order versioning (2026-10): when a save was refused
  // because someone else changed the services first, the order query is
  // refetched; once the newer version arrives, the form shows IT (staff
  // re-make their change on top of it) — never the stale draft.
  const orderId = order?.id ?? null;
  const editConflict = isCaseOrderChangedError(editOrder.error);
  useEffect(() => {
    if (open && editConflict) {
      setSelections(order ? selectionsFromLineItems(lineItems) : DEFAULT_SELECTIONS);
      setCustomItems(order ? customItemSelectionsFromLineItems(lineItems) : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const mutation = order ? editOrder : createOrder;
  // 2026-10: a selected item with no price set can't be saved (the server
  // refuses it with 422); the selector explains why, so Save is simply
  // disabled rather than offering a round trip that can only fail.
  const hasUnpricedSelection = calculateOrderTotals(catalog, selections).unpricedItems.length > 0;

  function saveOrder() {
    // Flush a custom item the user typed but never pressed "Add Custom
    // Item" for. Without this the draft lived only in the selector's own
    // state and was silently dropped on save — the item was neither
    // recorded nor reflected in the total. Uses the returned list, since
    // the selector's own onChangeCustomItems state update is not visible
    // synchronously here.
    const flushed = selectorRef.current?.commitPendingCustomItem() ?? null;
    if (order) {
      // Pinned to the version this form was loaded from (2026-10).
      editOrder.mutate({ selections, customItems: flushed ?? customItems, expectedOrderId: order.id }, { onSuccess: onClose });
    } else {
      createOrder.mutate({ selections, customItems: flushed ?? customItems }, { onSuccess: onClose });
    }
  }

  function serviceChangeInput(confirm: boolean, items: CustomLineItemSelection[]) {
    return {
      serviceTypeCode: selections.serviceTypeCode!,
      expectedWorkflowTemplateId: currentCase!.workflowTemplateId,
      expectedOrderId: order?.id ?? null,
      selections,
      ...(order ? { customItems: items } : {}),
      confirm,
    };
  }

  async function handleSave() {
    if (!serviceChanged || !currentCase || !selections.serviceTypeCode) {
      saveOrder();
      return;
    }
    // Same flush as saveOrder: the preview must price exactly what will
    // be confirmed, including a typed-but-unadded custom item.
    const flushed = selectorRef.current?.commitPendingCustomItem() ?? null;
    if (flushed) setCustomItems(flushed);
    setWorkflowError(null);
    try {
      const result = await serviceChange.mutateAsync(serviceChangeInput(false, flushed ?? customItems));
      if (!result.preview || result.preview.unchanged) {
        // The new service runs on the same workflow: an order-only edit.
        saveOrder();
        return;
      }
      setWorkflowPreview(result.preview);
      setOrderChangePreview(result.order && 'newTotal' in result.order ? result.order : null);
      setServiceChangeKey(newIdempotencyKey());
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : 'Could not preview the service change.');
    }
  }

  async function handleConfirmWorkflowChange() {
    if (!currentCase || !selections.serviceTypeCode || !serviceChangeKey) return;
    setWorkflowError(null);
    try {
      await serviceChange.mutateAsync({ ...serviceChangeInput(true, customItems), idempotencyKey: serviceChangeKey });
    } catch (error) {
      // A refusal/failure leaves the case and order as they were (or, after
      // a failed undo, says it needs repair) — the server's message says which.
      setWorkflowError(error instanceof Error ? error.message : 'Failed to change the service.');
      return;
    }
    setWorkflowPreview(null);
    onClose();
  }

  const title = order ? additionalItemsLabel(organizationId) : 'Set Up Services & Charges';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className={styles.header}>{title}</div>
      {order && usesAdditionalItemsTerminology(organizationId) && (
        <p className={styles.supportingText}>{ADDITIONAL_ITEMS_SUPPORTING_TEXT}</p>
      )}

      {workflowPreview ? (
        <WorkflowChangeConfirmation
          preview={workflowPreview}
          orderChange={orderChangePreview}
          isApplying={serviceChange.isPending}
          error={workflowError}
          onConfirm={handleConfirmWorkflowChange}
          onCancel={() => {
            setWorkflowPreview(null);
            setOrderChangePreview(null);
            setServiceChangeKey(null);
            setWorkflowError(null);
          }}
        />
      ) : (
        <ServicesAndChargesSelector
          ref={selectorRef}
          catalog={catalog}
          categories={categories}
          selections={selections}
          onChange={setSelections}
          {...(order ? { customItems, ...(canEditCustomItems ? { onChangeCustomItems: setCustomItems } : {}) } : {})}
        />
      )}

      {!workflowPreview && workflowError && (
        <div className={styles.error} role="alert">
          {workflowError}
        </div>
      )}

      {mutation.isError && (
        <div className={styles.error} role="alert">
          {isCaseOrderChangedError(mutation.error)
            ? 'These services were changed by someone else while you were editing. Nothing was saved. The latest services are now shown — make your change again and save.'
            : mutation.error instanceof Error
              ? mutation.error.message
              : 'Failed to save services.'}
        </div>
      )}

      {!workflowPreview && (
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={mutation.isPending || serviceChange.isPending || (hasUnpricedSelection && !serviceChanged)}
          >
            {mutation.isPending || serviceChange.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Modal>
  );
}
