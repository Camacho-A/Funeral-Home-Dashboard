import { NextResponse } from 'next/server';
import { CatalogPriceConflictError, isValidServiceCatalogPrice, updateServiceCatalogItemPrice } from '@/services/pricingService';
import { isPriceOnlyChange, updateCatalogItem, PriceCatalogUnavailableError } from '@/services/priceCatalogService';
import { authorizePriceCatalogWrite, priceCatalogErrorResponse, priceChangeJournalErrorResponse } from '@/lib/priceCatalogRoutes';

/**
 * Settings › Price Catalog — edits one catalog item.
 *
 * Body: `{ organizationId, expectedRevision?, displayName?, description?,
 * categoryId?, defaultPrice?, isActive?, ftcClass?, merchandiseProductId? }`
 * — at least one field — plus `confirmPrimaryServiceDeactivation: true`,
 * required to deactivate a primary service (409 `confirmation_required`
 * otherwise). Prices are
 * non-negative integer cents, or `null` for "price not set". An item's code
 * and pricing type never change once it exists. `expectedRevision` (the item's `revision` when
 * the editor opened) makes a concurrent edit a 409 instead of a silent
 * overwrite; the Price Catalog screen always sends it.
 *
 * Price catalog (2026-11): editing takes the organization's catalog-edit
 * permission; a price change and an active-flag change each take their own
 * (services/pricingAuthorization.ts). Organization-scoped: an item id from another
 * organization is 404, never 403. Every change is audited in the same
 * request, and changing an item never rewrites an existing case order.
 *
 * On live (Wix) data only a price-only change is supported today. A price
 * change may carry an idempotency key (`requestKey` in the body, or an
 * `Idempotency-Key` header): repeating the request never changes the price
 * twice — an already-saved change answers 200 with `duplicate: true`.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const authorized = await authorizePriceCatalogWrite(request);
  if (!authorized.ok) return authorized.response;
  const { organizationId, body, ctx, dataAdapterMode } = authorized.value;

  // `reason` (optional) is a note for the price history, not an item field.
  const { organizationId: _organizationId, expectedRevision, confirmPrimaryServiceDeactivation, reason, requestKey: bodyRequestKey, ...changes } = body;
  void _organizationId;
  const headerKey = request.headers.get('idempotency-key');
  const requestKey = typeof bodyRequestKey === 'string' && bodyRequestKey.trim() ? bodyRequestKey.trim() : headerKey?.trim() ? headerKey.trim() : null;
  if (requestKey && requestKey.length > 200) return NextResponse.json({ error: 'requestKey is too long (at most 200 characters).' }, { status: 400 });
  if (Object.keys(changes).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to change: send at least one of displayName, description, categoryId, defaultPrice, isActive, ftcClass or merchandiseProductId.' },
      { status: 400 },
    );
  }
  if ('defaultPrice' in changes && !isValidServiceCatalogPrice(changes.defaultPrice)) {
    return NextResponse.json(
      { error: 'defaultPrice must be a non-negative whole number of cents (at most $1,000,000.00), or null to clear the price.' },
      { status: 400 },
    );
  }

  if (dataAdapterMode !== 'mock') {
    if (!isPriceOnlyChange(changes)) return priceCatalogErrorResponse(new PriceCatalogUnavailableError());
    let result: Awaited<ReturnType<typeof updateServiceCatalogItemPrice>>;
    try {
      result = await updateServiceCatalogItemPrice(
        { organizationId, itemId, defaultPrice: changes.defaultPrice as number | null, ctx, reason: typeof reason === 'string' ? reason : null, requestKey },
        dataAdapterMode,
      );
    } catch (error) {
      if (error instanceof CatalogPriceConflictError) return NextResponse.json({ error: error.message, reason: 'price_conflict' }, { status: 409 });
      const journal = priceChangeJournalErrorResponse(error);
      if (journal) return journal;
      throw error;
    }
    if (!result) return NextResponse.json({ error: 'Service not found for this organization.' }, { status: 404 });
    return NextResponse.json({ item: result.item });
  }

  try {
    const { item } = await updateCatalogItem(
      { organizationId, itemId, changes, expectedRevision, confirmPrimaryServiceDeactivation, ...(typeof reason === 'string' ? { reason } : {}) },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json({ item });
  } catch (error) {
    return priceCatalogErrorResponse(error);
  }
}

