import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditServiceCatalog } from '@/services/authorizationPolicyService';
import { generateGeneralPriceList, BillingDocumentServiceError } from '@/services/billingDocumentService';
import { listOrgDocuments } from '@/services/orgDocumentService';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 39 (Family Billing & FTC Compliance). Generates / lists the
 * organization's General Price List versions. Gated by `serviceCatalog.edit`
 * (the pricing authority owns the catalog the GPL reflects).
 */
export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canEditServiceCatalog({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const priceLists = await listOrgDocuments(auth.context.organizationId, DOCUMENT_TYPES.PRICE_LIST_GENERAL.key, mode);
  return NextResponse.json({ priceLists });
}

export async function POST(request: Request) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; effectiveDate?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.effectiveDate !== 'string') return NextResponse.json({ error: 'effectiveDate is required.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(b.organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canEditServiceCatalog({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  try {
    const { orgDocument } = await generateGeneralPriceList(
      { effectiveDate: b.effectiveDate, idFactory: () => crypto.randomUUID() },
      { organizationId: auth.context.organizationId, actorIdentityId: auth.context.userId, actorMembershipId: null, actorRoleKey: auth.context.role, correlationId: crypto.randomUUID() },
      mode,
    );
    return NextResponse.json({ priceList: orgDocument }, { status: 201 });
  } catch (error) {
    if (error instanceof BillingDocumentServiceError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
}
