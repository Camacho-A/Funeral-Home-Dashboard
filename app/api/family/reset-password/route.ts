import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rateLimiter';
import { hashToken } from '@/lib/identity/tokens';
import { hashPassword } from '@/lib/identity/passwordHashing';
import { resetPortalPasswordWithToken } from '@/services/portal/portalUserService';
import { revokeAllSessionsForPortalUser } from '@/services/portal/portalSessionService';

const RATE_LIMIT_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Phase 29 (Family Portal & External Collaboration). Consumes a
 * password-reset token — never distinguishes "invalid" from "expired" in
 * its response. On success, revokes every existing `PortalSession` for
 * this user ("sign out everywhere" after a password reset), matching
 * `passwordService.ts`'s own precedent for the staff side.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = checkRateLimit(`family-reset-password:${ipAddress}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { token?: unknown; password?: unknown };
  if (typeof b.token !== 'string' || !b.token.trim()) {
    return NextResponse.json({ error: 'token is required.' }, { status: 400 });
  }
  if (typeof b.password !== 'string' || b.password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters.' }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const updated = await resetPortalPasswordWithToken(hashToken(b.token), hashPassword(b.password), dataAdapterMode);
  if (!updated) {
    return NextResponse.json({ error: 'This password reset link is invalid or has expired.' }, { status: 400 });
  }

  await revokeAllSessionsForPortalUser(updated.id, dataAdapterMode);

  return NextResponse.json({ ok: true });
}
