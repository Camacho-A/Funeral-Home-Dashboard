import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getDataAdapterMode } from '@/lib/env';
import { resolveSigningToken, declineSignatureRequest, SignatureServiceError } from '@/services/signatureService';

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
  const b = body as { reason?: unknown };
  if (b.reason !== undefined && typeof b.reason !== 'string') {
    return NextResponse.json({ error: 'reason must be a string if provided.' }, { status: 400 });
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
    const updated = await declineSignatureRequest(signatureRequest, { reason: b.reason as string | undefined, ipAddress, userAgent }, dataAdapterMode);
    return NextResponse.json({ status: updated.status });
  } catch (error) {
    if (error instanceof SignatureServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
