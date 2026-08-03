import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { resolveSigningToken, markSignatureViewed, getSigningPageContext, SignatureServiceError } from '@/services/signatureService';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). The public
 * signing surface's entry point — authenticated purely by the token in
 * the URL, never a Beacon session/cookie (see `signatureService.ts`'s
 * own header comment for why). Delegates entirely to
 * `services/signatureService.ts`; this route never validates the token
 * itself, never touches `CaseDocument`, never records an activity event.
 * Marks the request `viewed` on every access (first-view-only
 * transition; every access is still logged) — this is a GET, but unlike
 * `verify-email`'s deliberate "don't auto-consume on GET" precaution,
 * marking a request *viewed* is not a destructive, single-use action —
 * only `POST .../complete`/`POST .../decline` are.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const dataAdapterMode = getDataAdapterMode();

  let signatureRequest;
  try {
    signatureRequest = await resolveSigningToken(token, dataAdapterMode);
  } catch (error) {
    if (error instanceof SignatureServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const viewed = await markSignatureViewed(signatureRequest, dataAdapterMode);
  const context = await getSigningPageContext(viewed, dataAdapterMode);

  return NextResponse.json({
    status: viewed.status,
    signerName: viewed.signerName,
    signerRole: viewed.signerRole,
    expiresAt: viewed.expiresAt,
    ...context,
  });
}
