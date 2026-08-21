import type { DataAdapterMode } from '../../lib/env';
import { getActiveCaseOrder, listLineItemsForOrder } from '../pricingService';
import { buildPortalMerchandiseViews, type PortalMerchandiseView } from '../../domain/portal/portalMerchandiseView';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Thin family-facing read —
 * the merchandise on a case's active order, mapped through the family-safe
 * DTO (never cost/margin). Mirrors services/portal/portalPaymentService.ts's
 * "thin wrapper returning allowlisted DTOs only" shape.
 */
export async function listFamilyMerchandise(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalMerchandiseView[]> {
  const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (!order) return [];
  const lineItems = await listLineItemsForOrder(organizationId, order.id, dataAdapterMode);
  return buildPortalMerchandiseViews(lineItems);
}
