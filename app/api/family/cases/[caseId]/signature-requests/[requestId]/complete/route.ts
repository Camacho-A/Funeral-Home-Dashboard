import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { completeFamilySignature, PortalSignatureServiceError } from '@/services/portal/portalSignatureService';

/** Phase 29 (Family Portal & External Collaboration). Requires
    `signature.complete`. Delegates entirely to
    `services/signatureService.ts`'s own `completeSignatureRequest` — this
    route never touches document integrity/checksum logic itself. */
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
  const b = body as { signedName?: unknown };
  if (typeof b.signedName !== 'string' || !b.signedName.trim()) {
    return NextResponse.json({ error: 'signedName is required.' }, { status: 400 });
  }

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  try {
    const updated = await completeFamilySignature(
      {
        organizationId: accessResult.organizationId,
        caseId: accessResult.caseId,
        requestId,
        portalUserId: accessResult.portalUser.id,
        portalUserEmail: accessResult.portalUser.email,
        signedName: b.signedName,
        ipAddress,
        userAgent,
        idFactory: () => crypto.randomUUID(),
      },
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
