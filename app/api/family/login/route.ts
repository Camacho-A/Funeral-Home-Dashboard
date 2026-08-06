import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rateLimiter';
import { normalizeEmail } from '@/domain/identity/email';
import { findPortalUserByEmail } from '@/services/portal/portalUserService';
import { verifyPassword } from '@/lib/identity/passwordHashing';
import { createPortalSession } from '@/services/portal/portalSessionService';
import { createFamilySession } from '@/lib/auth/familySession';
import { recordPortalLogin } from '@/services/activityService';
import { portalActivityContext } from '@/services/portal/portalActivityContext';
import { getPrimaryOrganizationIdForPortalUser } from '@/services/portal/portalAccessService';

const RATE_LIMIT_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const GENERIC_INVALID_CREDENTIALS = { error: 'Invalid email or password.' };

/**
 * Phase 29 (Family Portal & External Collaboration). Never distinguishes
 * "no such email" from "wrong password" — the same "never reveal whether
 * an email exists" discipline `app/login/actions.ts`'s own identity-mode
 * branch follows. Rate-limited by `(ip, normalizedEmail)` — a genuinely
 * new investment for this codebase (refinement #13; staff login has none
 * today, per `docs/AUTHENTICATION.md`'s own admission, but that gap is
 * not silently repeated here). A disabled `PortalUser` fails exactly like
 * a wrong password — never a distinct message (no reason to reveal a
 * disabled account exists to whoever is guessing at it).
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
  const b = body as { email?: unknown; password?: unknown };
  if (typeof b.email !== 'string' || !b.email.trim()) {
    return NextResponse.json({ error: 'email is required.' }, { status: 400 });
  }
  if (typeof b.password !== 'string' || !b.password) {
    return NextResponse.json({ error: 'password is required.' }, { status: 400 });
  }

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = checkRateLimit(`family-login:${ipAddress}:${normalizeEmail(b.email)}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const portalUser = await findPortalUserByEmail(b.email, dataAdapterMode);
  const passwordValid = portalUser ? verifyPassword(b.password, portalUser.passwordHash) : false;

  if (!portalUser || !passwordValid || portalUser.status !== 'active') {
    return NextResponse.json(GENERIC_INVALID_CREDENTIALS, { status: 401 });
  }

  const userAgent = request.headers.get('user-agent');
  const portalSession = await createPortalSession(
    { portalUserId: portalUser.id, deviceId: crypto.randomUUID(), deviceName: userAgent, ipAddress, userAgent, idFactory: () => crypto.randomUUID() },
    dataAdapterMode,
  );
  await createFamilySession({ portalUserId: portalUser.id, sessionId: portalSession.id });

  // An ActivityEvent always needs an organizationId; a family login itself
  // isn't inherently scoped to one, so this attributes it to any one
  // currently-active grant's organization (in practice, a family member
  // has grants in exactly one organization). No active grant yet (e.g.
  // between accepting an invitation and staff activating a second one) —
  // best-effort only, matching every other activity-recording call site's
  // "never fail the real action over a logging gap" convention.
  try {
    const primaryOrganizationId = await getPrimaryOrganizationIdForPortalUser(portalUser.id, dataAdapterMode);
    if (primaryOrganizationId) {
      await recordPortalLogin(portalActivityContext(primaryOrganizationId, crypto.randomUUID()), portalUser.id, dataAdapterMode);
    }
  } catch (error) {
    console.error('Failed to record portal.login activity event:', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ ok: true, portalUser: { id: portalUser.id, displayName: portalUser.displayName } });
}
