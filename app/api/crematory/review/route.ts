import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeCrematory, crematoryErrorResponse } from '@/lib/crematory/routeAuth';
import { reviewCrematorySend } from '@/services/crematory/crematorySendService';

export const maxDuration = 60;

/**
 * Send to Crematory (2026-10) — the final review. Body: { organizationId,
 * caseIds }. Returns the exact email Confirm & Send would send (each
 * attachment as stored, default recipients, subject and message) and the
 * review fingerprint the send must carry. Read-only: nothing is prepared,
 * changed or sent. Limited to staff who may send.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const auth = await authorizeCrematory(body.organizationId, 'send');
  if (!auth.context) return auth.response;
  if (!Array.isArray(body.caseIds) || body.caseIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'caseIds must be a list of case ids.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await reviewCrematorySend(auth.context.organizationId, body.caseIds as string[], auth.mode), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return crematoryErrorResponse(error, 'Could not prepare the email for review. Nothing was sent. Please try again.');
  }
}
