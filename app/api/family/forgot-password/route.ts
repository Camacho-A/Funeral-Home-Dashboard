import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rateLimiter';
import { normalizeEmail, isValidEmailShape } from '@/domain/identity/email';
import { requestPortalPasswordReset } from '@/services/portal/portalUserService';
import { generateToken } from '@/lib/identity/tokens';
import { getIdentityMessageSender } from '@/lib/identity/messageSender';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const GENERIC_RESPONSE = { ok: true };

/**
 * Phase 29 (Family Portal & External Collaboration). Always returns the
 * same generic response whether or not the email belongs to a real
 * `PortalUser` — "never reveal whether an email exists," matching
 * `app/api/auth/forgot-password/route.ts`'s own precedent exactly. The
 * raw reset token never appears in this response; it only ever flows
 * into `getIdentityMessageSender().send(...)`.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { email?: unknown };
  if (typeof b.email !== 'string' || !isValidEmailShape(b.email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = checkRateLimit(`family-forgot-password:${ipAddress}:${normalizeEmail(b.email)}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(GENERIC_RESPONSE); // never reveal rate limiting to a prober either
  }

  const dataAdapterMode = getDataAdapterMode();
  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  const updated = await requestPortalPasswordReset({ email: b.email, tokenHash, expiresAt }, dataAdapterMode);
  if (updated) {
    try {
      await getIdentityMessageSender().send({ kind: 'password_reset', to: updated.email, token });
    } catch (error) {
      console.error('Failed to send Family Portal password reset email:', error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
