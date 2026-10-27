import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadCases } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { CremationLabelError, readSavedCremationLabel } from '@/services/cremationLabelService';

/**
 * Cremation Label (2026-10). One saved label version exactly as stored —
 * what the page previews and sends to the printer. Read-only; the stored
 * file is never re-made from the case. Download .dymo uses the ordinary
 * case-document download route instead.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const { caseId, documentId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  if (!getRegisteredOrganizationProfile(organizationId).features.dymoCaseLabel) {
    return NextResponse.json({ error: 'Labels are not set up for this organization.' }, { status: 404 });
  }
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadCases({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view this case.' }, { status: 403 });
  }

  try {
    const saved = await readSavedCremationLabel(organizationId, caseId, documentId, dataAdapterMode);
    return NextResponse.json(saved, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof CremationLabelError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Saved cremation label read failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The saved label could not be loaded. Please try again.' }, { status: 500 });
  }
}
