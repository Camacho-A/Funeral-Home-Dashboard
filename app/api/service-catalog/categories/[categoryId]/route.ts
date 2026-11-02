import { NextResponse } from 'next/server';
import { updateCatalogCategory } from '@/services/priceCatalogService';
import { authorizePriceCatalogWrite, priceCatalogErrorResponse } from '@/lib/priceCatalogRoutes';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). Renames, reorders,
 * deactivates or reactivates one display category. Body: `{ organizationId,
 * expectedRevision, name?, sortOrder?, isActive? }`. A deactivated category
 * keeps its items; it is only no longer offered for new ones.
 * Administrator only, audited, organization-scoped (another organization's
 * id is 404), demo data only for now.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  const authorized = await authorizePriceCatalogWrite(request);
  if (!authorized.ok) return authorized.response;
  const { organizationId, body, ctx, dataAdapterMode } = authorized.value;
  const { organizationId: _organizationId, expectedRevision, ...changes } = body;
  void _organizationId;
  for (const key of Object.keys(changes)) {
    if (key !== 'name' && key !== 'sortOrder' && key !== 'isActive') {
      return NextResponse.json({ error: `Unknown field: ${key}.` }, { status: 400 });
    }
  }
  try {
    const category = await updateCatalogCategory({ organizationId, categoryId, changes, expectedRevision }, ctx, dataAdapterMode);
    return NextResponse.json({ category });
  } catch (error) {
    return priceCatalogErrorResponse(error);
  }
}

