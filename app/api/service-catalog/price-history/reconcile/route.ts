import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { isAdminTier } from '@/services/authorizationPolicyService';
import { canPerformPricingAction } from '@/services/pricingAuthorization';
import { reconcileCatalogPriceChanges } from '@/services/catalogPriceChangeJournal';

/**
 * Price history recovery (2026-11). Administrators only (admin-tier plus
 * the organization's price-change permission); the caller's own
 * organization only.
 *
 * GET ?organizationId= — READ-ONLY report: every price change still
 * `pending` (and whether its item's marker shows it was applied), history
 * rows contradicted by their item's marker, and items whose price was
 * changed outside SOLIS's price path. Writes nothing.
 *
 * POST { organizationId } — settles each interrupted pending change from
 * its item's marker and corrects contradicted rows. Changes only history
 * statuses — never a price. A change younger than two minutes may still be
 * running and is left alone. Safe to repeat.
 */
async function authorize(
  organizationIdParam: string | null,
): Promise<{ ok: false; response: Response } | { ok: true; organizationId: string; dataAdapterMode: ReturnType<typeof getDataAdapterMode> }> {
  if (!organizationIdParam) return { ok: false, response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  const authResult = await requireAuthorizedOrganization(organizationIdParam);
  if (!authResult.authorized) return { ok: false, response: authResult.response };
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  const caller = { identityId: userId, organizationId, roleKey: role };
  const [admin, price] = await Promise.all([isAdminTier(caller, dataAdapterMode), canPerformPricingAction(caller, dataAdapterMode, 'catalog.price')]);
  if (!admin || !price) {
    return { ok: false, response: NextResponse.json({ error: 'Only an administrator who can change prices can review price history recovery.' }, { status: 403 }) };
  }
  return { ok: true, organizationId, dataAdapterMode };
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(new URL(request.url).searchParams.get('organizationId'));
  if (!auth.ok) return auth.response;
  const report = await reconcileCatalogPriceChanges(auth.organizationId, auth.dataAdapterMode, { apply: false });
  return NextResponse.json({ report });
}

export async function POST(request: Request): Promise<Response> {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const organizationIdParam = typeof body === 'object' && body !== null && typeof (body as { organizationId?: unknown }).organizationId === 'string'
    ? (body as { organizationId: string }).organizationId
    : null;
  const auth = await authorize(organizationIdParam);
  if (!auth.ok) return auth.response;
  const report = await reconcileCatalogPriceChanges(auth.organizationId, auth.dataAdapterMode, { apply: true });
  return NextResponse.json({ report });
}
