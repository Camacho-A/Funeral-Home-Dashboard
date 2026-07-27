import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { verifyEmailWithToken } from '@/services/emailVerificationService';

const ERROR_STATUS: Record<string, number> = {
  invalid_token: 400,
  expired_token: 400,
  already_used: 400,
};

/**
 * Phase 21 (Identity, Authentication & Session Management). Confirms an
 * email-verification token — the same underlying mechanism drives both a
 * plain signup's own verification and invitation acceptance (see
 * types/membership.ts's comment), but invitation acceptance always goes
 * through POST /api/auth/accept-invitation instead, since it must also
 * activate a specific membership and set a password atomically. This
 * route is for the plain "just verify my email" case.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { token } = parsed.body;

  if (typeof token !== 'string' || token.trim().length === 0) {
    return NextResponse.json({ error: 'token is required.' }, { status: 400 });
  }

  const result = await verifyEmailWithToken(token, getDataAdapterMode());
  if (!result.success) {
    return NextResponse.json({ error: 'This verification link is invalid or has expired.' }, { status: ERROR_STATUS[result.reason] ?? 400 });
  }

  return NextResponse.json({ ok: true });
}
