import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { listFamilyMerchandise } from '@/services/portal/portalMerchandiseService';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Family-facing, read-only
 * merchandise summary for a case — gated by the existing `payment.read`
 * capability (merchandise is part of the order the family pays), returning
 * only the family-safe DTO (name/quantity/price — never cost/margin/stock).
 * No storefront, no browsing of internal inventory.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'payment.read');
  if (!accessResult.authorized) return accessResult.response;
  const merchandise = await listFamilyMerchandise(accessResult.organizationId, accessResult.caseId, accessResult.dataAdapterMode);
  return NextResponse.json({ merchandise });
}
