import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFaxSettings, readJsonObject } from '@/lib/faxSettings/routeAuth';
import { recordFaxTestOutcome } from '@/services/faxTests/faxTestService';
import { faxTestErrorResponse } from '@/lib/faxTests/routeErrors';

/** Fax test transmissions (2026-11). POST { organizationId, expectedRevision, status, … } → { transmission }: what happened next. */
export async function POST(request: Request, { params }: { params: Promise<{ transmissionId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { transmissionId } = await params;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  const auth = await authorizeFaxSettings(body.organizationId);
  if (!auth.context) return auth.response;
  try {
    // The organization comes from the session check above, never from the body.
    const input: Record<string, unknown> = { ...body };
    delete input.organizationId;
    return NextResponse.json({ transmission: await recordFaxTestOutcome(auth.activity, transmissionId, input, auth.mode) });
  } catch (error) {
    return faxTestErrorResponse(error, 'The result could not be recorded. Reload and check before trying again.');
  }
}
