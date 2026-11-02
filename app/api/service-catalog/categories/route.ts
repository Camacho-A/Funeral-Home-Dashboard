import { NextResponse } from 'next/server';
import { createCatalogCategory } from '@/services/priceCatalogService';
import { authorizePriceCatalogWrite, priceCatalogErrorResponse } from '@/lib/priceCatalogRoutes';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). Settings › Price
 * Catalog › Categories › Add. Body: `{ organizationId, name }` — a name not
 * already used (case-insensitively) by this organization. Administrator
 * only, audited, demo data only for now. Categories are listed by
 * GET /api/service-catalog.
 */
export async function POST(request: Request) {
  const authorized = await authorizePriceCatalogWrite(request);
  if (!authorized.ok) return authorized.response;
  const { organizationId, body, ctx, dataAdapterMode } = authorized.value;
  try {
    const category = await createCatalogCategory({ organizationId, name: body.name }, ctx, dataAdapterMode);
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return priceCatalogErrorResponse(error);
  }
}

