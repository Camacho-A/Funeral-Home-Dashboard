import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canConfigureServiceCatalog } from '@/services/authorizationPolicyService';
import { canPerformPricingAction, isPriceCatalogManaged } from '@/services/pricingAuthorization';
import { PriceCatalogError, PriceCatalogUnavailableError } from '@/services/priceCatalogService';
import type { ActivityContext } from '@/services/activityService';
import type { DataAdapterMode } from '@/lib/env';
import type { ResolvePermissionsParams } from '@/services/permissionService';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). What every Settings ›
 * Price Catalog write route does before and after its one service call:
 * same-origin check, a JSON object body naming the organization, membership
 * of that organization, and `canConfigureServiceCatalog` (serviceCatalog.edit
 * + organization.manage); then the service's typed errors mapped to
 * responses. A member without the permission gets 403 before any input is
 * looked at.
 */

export type PriceCatalogWriteContext = {
  organizationId: string;
  body: Record<string, unknown>;
  ctx: ActivityContext;
  dataAdapterMode: DataAdapterMode;
};

export async function authorizePriceCatalogWrite(request: Request): Promise<{ ok: true; value: PriceCatalogWriteContext } | { ok: false; response: Response }> {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return { ok: false, response: csrfResponse };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }) };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.organizationId !== 'string') {
    return { ok: false, response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  }

  const authResult = await requireAuthorizedOrganization(record.organizationId);
  if (!authResult.authorized) return { ok: false, response: authResult.response };
  const { organizationId, userId, role } = authResult.context;

  // Only an organization that manages its catalog in SOLIS (not Manors).
  if (!isPriceCatalogManaged(organizationId)) return { ok: false, response: NextResponse.json({ error: 'Not found.' }, { status: 404 }) };
  const dataAdapterMode = getDataAdapterMode();
  const caller = { identityId: userId, organizationId, roleKey: role };
  if (!(await canConfigureServiceCatalog(caller, dataAdapterMode))) {
    return { ok: false, response: NextResponse.json({ error: 'You are not allowed to change the price catalog.' }, { status: 403 }) };
  }
  // Changing a price, or an item's active flag, takes its own permission.
  // Creating an item with no price yet ("Price not set") is not a price change.
  const setsPrice = 'defaultPrice' in record && !(request.method === 'POST' && record.defaultPrice === null);
  if (setsPrice && !(await canPerformPricingAction(caller, dataAdapterMode, 'catalog.price'))) {
    return { ok: false, response: NextResponse.json({ error: 'You are not allowed to change prices.', reason: 'price_not_permitted' }, { status: 403 }) };
  }
  if ('isActive' in record && !(await canPerformPricingAction(caller, dataAdapterMode, 'catalog.deactivate'))) {
    return { ok: false, response: NextResponse.json({ error: 'You are not allowed to deactivate or reactivate catalog items.', reason: 'deactivate_not_permitted' }, { status: 403 }) };
  }
  return {
    ok: true,
    value: {
      organizationId,
      body: record,
      dataAdapterMode,
      ctx: { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
    },
  };
}

/** The service's typed refusals as responses; anything else rethrows. */
export function priceCatalogErrorResponse(error: unknown): Response {
  if (error instanceof PriceCatalogError) {
    return NextResponse.json({ error: error.message, reason: error.reason }, { status: error.status });
  }
  if (error instanceof PriceCatalogUnavailableError) {
    return NextResponse.json({ error: error.message, reason: 'unavailable' }, { status: 501 });
  }
  throw error;
}

/**
 * Gus Phase 5C-3 (finalization). A merchandise product's retail price (or a
 * variant's price override) is a standard price, so setting one takes the
 * same administrator authority as the Price Catalog
 * (canConfigureServiceCatalog). Every other merchandise and inventory
 * permission is unchanged. Returns the 403 to send, or null when allowed.
 */
export async function standardPriceRefusal(
  caller: ResolvePermissionsParams,
  dataAdapterMode: DataAdapterMode,
): Promise<Response | null> {
  if (await canPerformPricingAction(caller, dataAdapterMode, 'catalog.price', { merchandise: true })) return null;
  return NextResponse.json({ error: 'You are not allowed to set merchandise prices.', reason: 'price_not_permitted' }, { status: 403 });
}
