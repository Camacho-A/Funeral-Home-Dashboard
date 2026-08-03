import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getDataAdapterMode } from '@/lib/env';
import { resolveSigningToken, completeSignatureRequest, SignatureServiceError } from '@/services/signatureService';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). The one
 * route that finalizes a signature. CSRF-protected via `requireSameOrigin`
 * despite having no session to protect — a signer submitting a form is
 * still a cross-site-forgeable POST. Replay protection here is the
 * request's own state machine (`completeSignatureRequest` rejects an
 * already-terminal request outright), not token single-use — see
 * `services/signatureService.ts`'s own header comment for why a signing
 * token is not burned on first use, unlike every other token in this
 * codebase.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { token } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { signedName?: unknown; initials?: unknown; consentAcknowledged?: unknown };
  if (typeof b.signedName !== 'string' || !b.signedName.trim()) {
    return NextResponse.json({ error: 'Please type your full name to sign.' }, { status: 400 });
  }
  if (b.initials !== undefined && typeof b.initials !== 'string') {
    return NextResponse.json({ error: 'initials must be a string if provided.' }, { status: 400 });
  }
  if (b.consentAcknowledged !== true) {
    return NextResponse.json({ error: 'You must acknowledge consent before signing.' }, { status: 400 });
  }

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

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  try {
    const { request: updatedRequest, record } = await completeSignatureRequest(
      signatureRequest,
      { signedName: b.signedName, initials: b.initials as string | undefined, ipAddress, userAgent, idFactory: () => crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ status: updatedRequest.status, signedAt: record.signedAt });
  } catch (error) {
    if (error instanceof SignatureServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
