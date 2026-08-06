import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { declineFamilySignature, PortalSignatureServiceError } from '@/services/portal/portalSignatureService';

/** Phase 29 (Family Portal & External Collaboration). Requires
    `signature.complete` — the same capability covers declining as
    completing (there is no separate "decline" capability). */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; requestId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, requestId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'signature.complete');
  if (!accessResult.authorized) return accessResult.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { reason?: unknown };
  if (b.reason !== undefined && typeof b.reason !== 'string') {
    return NextResponse.json({ error: 'reason must be a string if provided.' }, { status: 400 });
  }

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  try {
    const updated = await declineFamilySignature(
      { organizationId: accessResult.organizationId, caseId: accessResult.caseId, requestId, portalUserEmail: accessResult.portalUser.email, reason: b.reason, ipAddress, userAgent },
      accessResult.dataAdapterMode,
    );
    return NextResponse.json({ request: updated });
  } catch (error) {
    if (error instanceof PortalSignatureServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 422 });
    }
    throw error;
  }
}
