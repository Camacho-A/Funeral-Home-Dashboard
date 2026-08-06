import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rateLimiter';
import { acceptInvitation } from '@/services/portal/portalInvitationService';
import { createFamilySession } from '@/lib/auth/familySession';

const RATE_LIMIT_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Phase 29 (Family Portal & External Collaboration). Public, unauthenticated
 * — the token itself is the only proof of identity, exactly like
 * `POST /api/signing/[token]/complete`. Never distinguishes "invalid",
 * "expired", or "already used" in its response (existence-hiding,
 * matching `services/portal/portalInvitationService.ts`'s own
 * `resolveInvitationToken`). Rate-limited by IP alone — the token hasn't
 * resolved to an email yet at the point the limit must apply.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = checkRateLimit(`accept-invitation:${ipAddress}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS);
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
  const userAgent = request.headers.get('user-agent');

  const result = await acceptInvitation(
    { token: b.token, password: b.password, deviceId: crypto.randomUUID(), deviceName: userAgent, ipAddress, userAgent, idFactory: () => crypto.randomUUID() },
    dataAdapterMode,
  );

  if (!result.success) {
    return NextResponse.json({ error: 'This invitation link is invalid or has expired.' }, { status: 400 });
  }

  await createFamilySession({ portalUserId: result.portalUser.id, sessionId: result.portalSession.id });

  return NextResponse.json({ ok: true, portalUser: { id: result.portalUser.id, displayName: result.portalUser.displayName } });
}
