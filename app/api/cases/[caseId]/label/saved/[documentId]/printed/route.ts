import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadCases } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { CremationLabelError, recordSavedCremationLabelPrinted } from '@/services/cremationLabelService';

/**
 * Cremation Label (2026-10). Records that a saved label version was sent
 * to a printer — the print itself happens on the staff member's computer
 * through DYMO Connect, so the page reports it here for the audit trail.
 * Changes nothing about the label.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId, documentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = (body ?? {}) as { organizationId?: unknown; printerName?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.printerName !== 'string' || b.printerName.trim() === '') return NextResponse.json({ error: 'printerName is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
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
    await recordSavedCremationLabelPrinted(
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      caseId,
      documentId,
      b.printerName.trim(),
      dataAdapterMode,
    );
    return NextResponse.json({ recorded: true });
  } catch (error) {
    if (error instanceof CremationLabelError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Cremation label print record failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The print could not be recorded.' }, { status: 500 });
  }
}
