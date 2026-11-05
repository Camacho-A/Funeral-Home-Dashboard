import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFaxSettings, readJsonObject } from '@/lib/faxSettings/routeAuth';
import { getFaxTestOverview, sendFaxTest } from '@/services/faxTests/faxTestService';
import { faxTestErrorResponse } from '@/lib/faxTests/routeErrors';

/**
 * Fax test transmissions (2026-11, docs/FAX_TEST_TRANSMISSIONS.md).
 *   GET  ?organizationId=…   → { overview }: recipients (keys and display only),
 *                              steps, open test, history
 *   POST { organizationId, step, recipientKey, submissionId, confirm }
 *                            → { duplicate, transmission }: ONE fictional test PDF
 *                              to an approved test recipient. Real bundles are
 *                              never involved.
 * Administrators who may fax only — checked here and again in the service.
 */
export async function GET(request: Request) {
  const auth = await authorizeFaxSettings(new URL(request.url).searchParams.get('organizationId'));
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ overview: await getFaxTestOverview(auth.activity, auth.mode) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return faxTestErrorResponse(error, 'Fax tests could not be loaded.');
  }
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  const auth = await authorizeFaxSettings(body.organizationId);
  if (!auth.context) return auth.response;
  try {
    // The organization comes from the session check above, never from the body.
    const input: Record<string, unknown> = { ...body };
    delete input.organizationId;
    return NextResponse.json(await sendFaxTest(auth.activity, input, auth.mode));
  } catch (error) {
    return faxTestErrorResponse(error, 'The test could not be sent. Check the test history before trying again.');
  }
}
