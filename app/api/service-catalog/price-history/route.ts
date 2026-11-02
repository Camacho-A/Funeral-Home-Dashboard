import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canPerformPricingAction } from '@/services/pricingAuthorization';
import { listCatalogPriceHistory } from '@/services/catalogPriceHistoryService';
import type { CatalogPriceItemType } from '@/types/catalogPriceChange';

const ITEM_TYPES: readonly CatalogPriceItemType[] = ['service', 'merchandise_product', 'merchandise_variant'];

/**
 * Price catalog (2026-11). GET /api/service-catalog/price-history
 * ?organizationId=&itemType=&itemId= — one item's price history, newest
 * first: every previous price, who changed it and when. Read-only; takes
 * the organization's catalog-view permission; organization-scoped (another
 * organization's item simply has no history here).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const itemType = url.searchParams.get('itemType') as CatalogPriceItemType | null;
  const itemId = url.searchParams.get('itemId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (!itemType || !ITEM_TYPES.includes(itemType) || !itemId) {
    return NextResponse.json({ error: `itemType (one of ${ITEM_TYPES.join(', ')}) and itemId are required.` }, { status: 400 });
  }
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canPerformPricingAction({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode, 'catalog.view'))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const history = await listCatalogPriceHistory(organizationId, { itemType, itemId }, dataAdapterMode);
  return NextResponse.json({ history });
}
