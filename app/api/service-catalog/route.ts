import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { getServiceCatalog } from '@/services/pricingService';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Read-only,
 * organization-scoped list of active services (the "Services & Charges"
 * UI's one and only source of which services/prices exist — never
 * hardcoded in a component; see components/case/ServicesAndChargesSelector.tsx).
 * Same shape as GET /api/cases/[caseId]/payments — auth-scoped by the
 * query itself, no separate ownership check needed for a read.
 */
export async function GET(request: Request) {
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ catalog: [], error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const catalog = await getServiceCatalog(organizationId, getDataAdapterMode());
  return NextResponse.json({ catalog });
}
