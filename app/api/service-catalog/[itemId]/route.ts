import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditServiceCatalog } from '@/services/authorizationPolicyService';
import { isValidServiceCatalogPrice, updateServiceCatalogItemPrice } from '@/services/pricingService';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). Settings › Services & Pricing
 * — sets one catalog row's price, or clears it back to "price not set".
 *
 * Body: `{ organizationId, defaultPrice }` where `defaultPrice` is a
 * non-negative integer number of cents, or `null`. Nothing else about the
 * row (name, code, category, active flag) is editable here.
 *
 * Gated by `serviceCatalog.edit` — the existing pricing-authority key that
 * already gates the FTC General Price List (app/api/settings/price-list),
 * held by Administrator and Manager only. Organization-scoped: the row must
 * belong to the caller's authorized organization, else 404 (never 403 — an
 * id from another tenant is indistinguishable from a missing one). Changing
 * a price never rewrites an existing case order.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { itemId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; defaultPrice?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  // Only where the organization edits its prices in SOLIS (not Manors).
  if (!getRegisteredOrganizationProfile(organizationId).features.serviceCatalogPriceEditing) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const dataAdapterMode = getDataAdapterMode();
  if (!(await canEditServiceCatalog({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (!('defaultPrice' in b) || !isValidServiceCatalogPrice(b.defaultPrice)) {
    return NextResponse.json(
      { error: 'defaultPrice must be a non-negative whole number of cents (at most $1,000,000.00), or null to clear the price.' },
      { status: 400 },
    );
  }

  const result = await updateServiceCatalogItemPrice(
    {
      organizationId,
      itemId,
      defaultPrice: b.defaultPrice,
      ctx: { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
    },
    dataAdapterMode,
  );
  if (!result) {
    return NextResponse.json({ error: 'Service not found for this organization.' }, { status: 404 });
  }
  return NextResponse.json({ item: result.item });
}
