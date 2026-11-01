'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ServicesAndChargesSelector, type ServicesAndChargesSelectorHandle } from '@/components/case/ServicesAndChargesSelector';
import { useServiceCatalog } from '@/hooks/useServiceCatalog';
import { useCreateCaseOrder, useEditCaseOrder } from '@/hooks/useCaseOrder';
import { useOrganization } from '@/hooks/useOrganization';
import { selectionsFromLineItems, customItemSelectionsFromLineItems, calculateOrderTotals } from '@/domain/pricing/calculateOrder';
import { additionalItemsLabel, usesAdditionalItemsTerminology, ADDITIONAL_ITEMS_SUPPORTING_TEXT } from '@/domain/organization/caseOrderTerminology';
import type { CaseOrder, CaseOrderLineItem, ServiceSelections, CustomLineItemSelection } from '@/types/caseOrder';
import { isCaseOrderChangedError } from '@/services/pricingClient';
import styles from './EditServicesModal.module.css';

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
  const { data: catalog = [] } = useServiceCatalog();
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

  // Re-seed the draft from the current order every time the modal opens —
  // never carry a stale draft from a previous open across into a fresh one.
  useEffect(() => {
    if (open) {
      setSelections(order ? selectionsFromLineItems(lineItems) : DEFAULT_SELECTIONS);
      setCustomItems(order ? customItemSelectionsFromLineItems(lineItems) : []);
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

  function handleSave() {
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

  const title = order ? additionalItemsLabel(organizationId) : 'Set Up Services & Charges';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className={styles.header}>{title}</div>
      {order && usesAdditionalItemsTerminology(organizationId) && (
        <p className={styles.supportingText}>{ADDITIONAL_ITEMS_SUPPORTING_TEXT}</p>
      )}

      <ServicesAndChargesSelector
        ref={selectorRef}
        catalog={catalog}
        selections={selections}
        onChange={setSelections}
        {...(order ? { customItems, onChangeCustomItems: setCustomItems } : {})}
      />

      {mutation.isError && (
        <div className={styles.error} role="alert">
          {isCaseOrderChangedError(mutation.error)
            ? 'These services were changed by someone else while you were editing. Nothing was saved. The latest services are now shown — make your change again and save.'
            : mutation.error instanceof Error
              ? mutation.error.message
              : 'Failed to save services.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={mutation.isPending || hasUnpricedSelection}>
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
