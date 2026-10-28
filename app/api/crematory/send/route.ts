import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { activityContext, authorizeCrematory, crematoryErrorResponse } from '@/lib/crematory/routeAuth';
import { sendCrematoryPackages } from '@/services/crematory/crematorySendService';

export const maxDuration = 120;

/**
 * Send to Crematory (2026-10). Sends ONE Outlook email with one Crematory
 * Package per selected case, after the staff member reviewed and
 * confirmed it. Body: { organizationId, caseIds, to, cc, subject, message,
 * submissionId, confirmResend }. 200 → submitted to Outlook (not a
 * delivery confirmation).
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
    const result = await sendCrematoryPackages(
      activityContext(auth.context, crypto.randomUUID()),
      {
        caseIds: body.caseIds as string[],
        to: body.to,
        cc: body.cc,
        subject: typeof body.subject === 'string' ? body.subject : '',
        message: typeof body.message === 'string' ? body.message : '',
        submissionId: typeof body.submissionId === 'string' ? body.submissionId : '',
        confirmResend: body.confirmResend === true,
      },
      auth.mode,
    );
    return NextResponse.json(result);
  } catch (error) {
    return crematoryErrorResponse(error, 'The email could not be sent. Please try again.');
  }
}
