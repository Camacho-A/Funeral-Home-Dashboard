import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadServiceCatalog } from '@/services/authorizationPolicyService';
import { getServiceCatalog } from '@/services/pricingService';
import { createCatalogItem, listCatalogCategories } from '@/services/priceCatalogService';
import { SERVICE_TYPE_CATEGORY } from '@/domain/pricing/serviceCodes';
import { authorizePriceCatalogWrite, priceCatalogErrorResponse } from '@/lib/priceCatalogRoutes';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Read-only,
 * organization-scoped list of active services (the "Services & Charges"
 * UI's one and only source of which services/prices exist — never
 * hardcoded in a component; see components/case/ServicesAndChargesSelector.tsx).
 * Same shape as GET /api/cases/[caseId]/payments — auth-scoped by the
 * query itself, no separate ownership check needed for a read.
 *
 * Gus Phase 5C-3: also returns the organization's display `categories`, and
 * any deactivated primary service (isActive: false) for display.
 * `includeInactive=1` (Settings › Price Catalog) adds deactivated items and
 * categories, and takes `serviceCatalog.read`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ catalog: [], error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();
  const includeInactive = url.searchParams.get('includeInactive') === '1';
  if (includeInactive && !(await canReadServiceCatalog({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const [rows, categories] = await Promise.all([
    getServiceCatalog(organizationId, dataAdapterMode, { includeInactive: true }),
    listCatalogCategories(organizationId, dataAdapterMode, { includeInactive }),
  ]);
  // Gus Phase 5C-3 (finalization): a deactivated PRIMARY service stays in the
  // default list (flagged isActive: false) so existing cases on it still show
  // its name; every order and new-case screen offers only active rows.
  const catalog = includeInactive ? rows : rows.filter((item) => item.isActive || item.category === SERVICE_TYPE_CATEGORY);
  return NextResponse.json({ catalog, categories });
}

/**
 * Gus Phase 5C-3. Settings › Price Catalog › Add item. Body:
 * `{ organizationId, itemCode, displayName, description?, categoryId?,
 * pricingType: 'flat' | 'per_unit', defaultPrice: cents | null }`.
 * Administrator only (serviceCatalog.edit + organization.manage); the item
 * code must be unique within the organization. Demo data only for now.
 */
export async function POST(request: Request) {
  const authorized = await authorizePriceCatalogWrite(request);
  if (!authorized.ok) return authorized.response;
  const { organizationId, body, ctx, dataAdapterMode } = authorized.value;
  try {
    const item = await createCatalogItem({ organizationId, input: body }, ctx, dataAdapterMode);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return priceCatalogErrorResponse(error);
  }
}

