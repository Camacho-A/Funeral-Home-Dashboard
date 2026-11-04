import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFax, faxActivityContext, faxErrorResponse } from '@/lib/faxBundles/routeAuth';
import { sendFaxBundle } from '@/services/faxBundles/faxBundleService';

export const maxDuration = 120;

/**
 * Send Fax (2026-11): the previewed bundle, as one email with one PDF to
 * the NuSo gateway. Body { organizationId, submissionId } — the same
 * submissionId again never sends again. 200 → submitted to NuSo, not a
 * delivery confirmation.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { bundleId } = await params;
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const auth = await authorizeFax(body.organizationId, 'send');
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json(await sendFaxBundle(faxActivityContext(auth.context, crypto.randomUUID()), bundleId, body.submissionId, auth.mode));
  } catch (error) {
    return faxErrorResponse(error, 'The fax could not be sent. Check the bundle before trying again.');
  }
}
