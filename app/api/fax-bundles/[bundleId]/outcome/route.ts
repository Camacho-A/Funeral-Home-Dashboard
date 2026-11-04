import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFax, faxActivityContext, faxErrorResponse } from '@/lib/faxBundles/routeAuth';
import { recordFaxBundleOutcome } from '@/services/faxBundles/faxBundleService';

/**
 * An Administrator or Manager records what NuSo reported for a sent bundle.
 * multipart/form-data: organizationId, decision ('delivered' | 'failed'),
 * optional deliveredAt (ISO), nusoReference, note and confirmation (file).
 * Nothing is sent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { bundleId } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form body.' }, { status: 400 });
  }
  const auth = await authorizeFax(form.get('organizationId'), 'outcome');
  if (!auth.context) return auth.response;
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : undefined;
  };
  const file = form.get('confirmation');
  const confirmation =
    file && typeof file !== 'string' && file.size > 0
      ? { fileName: file.name || 'confirmation', mimeType: (file.type || (file.name.toLowerCase().endsWith('.eml') ? 'message/rfc822' : '')).toLowerCase(), bytes: new Uint8Array(await file.arrayBuffer()) }
      : null;
  try {
    const result = await recordFaxBundleOutcome(
      faxActivityContext(auth.context, crypto.randomUUID()),
      bundleId,
      { decision: text('decision'), deliveredAt: text('deliveredAt'), nusoReference: text('nusoReference'), note: text('note'), confirmation },
      auth.mode,
    );
    return NextResponse.json(result);
  } catch (error) {
    return faxErrorResponse(error, 'The outcome could not be recorded. Please try again.');
  }
}
