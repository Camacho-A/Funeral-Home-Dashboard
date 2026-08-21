import type { CaseOrderLineItem } from '../../types/caseOrder';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). The family-safe merchandise
 * DTO — the allowlist that guarantees INTERNAL cost/margin, supplier, and
 * stock data never reach a family user (a structural test asserts no
 * `/api/family/*` DTO carries a `cost` field). A family member sees only the
 * merchandise selected on THEIR case, within the order summary: name,
 * quantity, and the retail price they are charged. Mirrors
 * `domain/portal/portalPaymentView.ts`'s exact allowlist-builder pattern.
 */
export type PortalMerchandiseView = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export function buildPortalMerchandiseView(lineItem: CaseOrderLineItem): PortalMerchandiseView {
  // `description` is the retail-facing product name snapshot; `sku`/`productId`
  // (in metadata) and every cost field are deliberately omitted.
  return {
    id: lineItem.id,
    name: lineItem.description,
    quantity: lineItem.quantity,
    unitPrice: lineItem.unitPrice,
    lineTotal: lineItem.lineTotal,
  };
}

/** Only merchandise lines from a case's active order, mapped to the family
    view. Service lines are excluded (they surface in the payment/order
    summary already), and a non-merchandise line never leaks. */
export function buildPortalMerchandiseViews(lineItems: CaseOrderLineItem[]): PortalMerchandiseView[] {
  return lineItems.filter((li) => li.lineKind === 'merchandise').map(buildPortalMerchandiseView);
}
