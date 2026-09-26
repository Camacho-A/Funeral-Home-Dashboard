import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { checkBlobConnectivity } from '@/services/documentService';

/**
 * TEMPORARY diagnostic (2026-09) — Vercel Blob connectivity check for the
 * newly-connected production store. Administrator-only (`user.manageRoles`,
 * the same break-glass permission the Manors go-live cutover control uses).
 * Delegates entirely to `services/documentService.ts#checkBlobConnectivity`,
 * which exercises the EXACT storage provider every real document upload
 * uses — this route never imports the concrete provider itself, preserving
 * that module's own structural boundary (enforced by
 * services/documentService.test.ts). No CaseDocument, no Wix Data row, no
 * case is ever touched.
 *
 * Returns only a sanitized {configured, upload, delete, cleanup} shape —
 * never the token value, never a raw provider error. Remove this route
 * (and `checkBlobConnectivity`) once the connectivity check has been run
 * and confirmed.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const mode = getDataAdapterMode();
  if (!(await canManageRoles({ identityId: authResult.context.userId, organizationId, roleKey: authResult.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const result = await checkBlobConnectivity();
  if (!result.configured) {
    return NextResponse.json({ configured: false, upload: 'skipped', delete: 'skipped', cleanup: 'skipped' });
  }
  if (result.upload === 'failed') {
    return NextResponse.json({ configured: true, upload: 'failed', delete: 'skipped', cleanup: 'failed', errorCategory: result.errorCategory });
  }
  if (result.delete === 'failed') {
    return NextResponse.json({ configured: true, upload: 'success', delete: 'failed', cleanup: 'failed', errorCategory: result.errorCategory });
  }
  return NextResponse.json({ configured: true, upload: 'success', delete: 'success', cleanup: 'success' });
}
