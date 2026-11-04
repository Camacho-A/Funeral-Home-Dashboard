import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFax, faxActivityContext, faxErrorResponse } from '@/lib/faxBundles/routeAuth';
import { listFaxEligibleCases, previewFaxBundle } from '@/services/faxBundles/faxBundleService';

export const maxDuration = 120;

/**
 * Manatee County DC application fax bundles (2026-11).
 *   GET  ?organizationId=…                 → the cases staff can choose from
 *   POST { organizationId, caseIds }       → 201: the bundle, built and stored
 *                                            (exactly these cases, in this order)
 * Nothing is sent here.
 */
export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  const auth = await authorizeFax(organizationId, 'send');
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json(await listFaxEligibleCases(auth.context.organizationId, auth.mode), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return faxErrorResponse(error, 'The applications could not be loaded. Please try again.');
  }
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const auth = await authorizeFax(body.organizationId, 'send');
  if (!auth.context) return auth.response;
  try {
    const bundle = await previewFaxBundle(faxActivityContext(auth.context, crypto.randomUUID()), body.caseIds, auth.mode);
    return NextResponse.json({ bundle }, { status: 201 });
  } catch (error) {
    return faxErrorResponse(error, 'The bundle could not be prepared. Please try again.');
  }
}
