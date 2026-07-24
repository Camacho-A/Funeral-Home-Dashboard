'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ServicesAndChargesSelector } from '@/components/case/ServicesAndChargesSelector';
import { useSession } from '@/hooks/useSession';
import { useServiceCatalog } from '@/hooks/useServiceCatalog';
import { useCreateCaseOrder, useEditCaseOrder } from '@/hooks/useCaseOrder';
import { selectionsFromLineItems } from '@/domain/pricing/calculateOrder';
import type { CaseOrder, CaseOrderLineItem, ServiceSelections } from '@/types/caseOrder';
import styles from './EditServicesModal.module.css';

const DEFAULT_SELECTIONS: ServiceSelections = {
  weightTier: 'under_200',
  extraDeathCertificateQuantity: 0,
  mailCremated: false,
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
  const session = useSession();
  const { data: catalog = [] } = useServiceCatalog();
  const createOrder = useCreateCaseOrder(caseId);
  const editOrder = useEditCaseOrder(caseId);

  const initialSelections = order ? selectionsFromLineItems(lineItems) : DEFAULT_SELECTIONS;
  const [selections, setSelections] = useState<ServiceSelections>(initialSelections);

  // Re-seed the draft from the current order every time the modal opens —
  // never carry a stale draft from a previous open across into a fresh one.
  useEffect(() => {
    if (open) setSelections(order ? selectionsFromLineItems(lineItems) : DEFAULT_SELECTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = order ? editOrder : createOrder;

  function handleSave() {
    mutation.mutate(
      { selections, performedBy: session.displayName },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={order ? 'Edit Services' : 'Set Up Services & Charges'}>
      <div className={styles.header}>{order ? 'Edit Services' : 'Set Up Services & Charges'}</div>

      <ServicesAndChargesSelector catalog={catalog} selections={selections} onChange={setSelections} />

      {mutation.isError && (
        <div className={styles.error} role="alert">
          {mutation.error instanceof Error ? mutation.error.message : 'Failed to save services.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
