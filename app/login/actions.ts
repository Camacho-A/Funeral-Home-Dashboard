'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuthAdapterMode, getDataAdapterMode } from '@/lib/env';
import { verifyMockCredentials } from '@/lib/auth/mockAuth';
import { loginWithWix } from '@/lib/auth/wixAuth';
import { createSession, clearSession, getSession } from '@/lib/auth/session';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { findIdentityByEmail, getIdentityById, recordSuccessfulLogin } from '@/services/identityService';
import { verifyPassword } from '@/services/passwordService';
import { recordLoginActivity, checkAndApplyLockout, unlockIfExpired } from '@/services/accountRecoveryService';
import { createIdentitySession, revokeSession } from '@/services/sessionService';

/**
 * Phase 13 (Authentication & Organizations). Server Actions get Next.js's
 * built-in Origin-header CSRF protection for free — this is the "CSRF
 * protection where state-changing cookie-authenticated requests require
 * it" requirement, satisfied by using the platform's own mechanism rather
 * than hand-rolling a token scheme for these two actions.
 *
 * Never logs the submitted email, password, or any token — on failure,
 * only a generic `reason` code travels via the redirect URL (never the
 * credentials themselves), and the login page maps that code to a
 * deliberately non-specific message (lib/auth/mockAuth.ts's own comment
 * explains why "invalid email or password" is used regardless of which
 * part was actually wrong).
 *
 * Phase 15A.1 (Auth/Data Adapter Separation): branches on AUTH_ADAPTER,
 * not DATA_ADAPTER — which login provider is used is now independent of
 * which backend `services/*` read/write against, so e.g. DATA_ADAPTER=wix
 * with AUTH_ADAPTER=mock (real Wix-backed reads, mock login) works as a
 * real local-development combination. Neither verifyMockCredentials nor
 * loginWithWix themselves changed at all.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = sanitizeRedirectPath(String(formData.get('next') ?? ''));
  const nextParam = encodeURIComponent(next);

  const authAdapter = getAuthAdapterMode();

  if (authAdapter === 'mock') {
    const result = verifyMockCredentials(email, password);
    if (!result.success) {
      redirect(`/login?error=invalid_credentials&next=${nextParam}`);
    }
    await createSession(result.user);
    redirect(next);
  }

  if (authAdapter === 'identity') {
    await handleIdentityLogin(email, password, formData.get('rememberDevice') === 'on', next, nextParam);
  }

  let wixResult;
  try {
    wixResult = await loginWithWix(email, password);
  } catch {
    // Never surface the underlying SDK/network error to the client.
    redirect(`/login?error=unknown&next=${nextParam}`);
  }

  if (!wixResult.success) {
    redirect(`/login?error=${wixResult.reason}&next=${nextParam}`);
  }

  await createSession(wixResult.user);
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  if (session?.user.source === 'identity' && session.sessionId) {
    // Revokes the server-side registry row, not just the browser's cookie —
    // otherwise a copied/replayed token would remain valid (per its own
    // registry row) until it naturally expired, even after this browser
    // signed out.
    await revokeSession(session.sessionId, getDataAdapterMode());
  }
  await clearSession();
  redirect('/login');
}

/**
 * Phase 21 (Identity, Authentication & Session Management). The
 * `AUTH_ADAPTER='identity'` login path — kept as its own function rather
 * than inlined into loginAction's already-branching body, since it's
 * meaningfully longer than the mock/wix branches (lockout, activity
 * recording, session-registry creation) while still following the exact
 * same shape: verify -> on failure redirect with a generic reason code ->
 * on success createSession + redirect.
 *
 * Deliberately does not distinguish "no such identity" from "wrong
 * password" (both fall through to the same `invalid_credentials` reason) —
 * "never reveal whether an email exists" applies here exactly as it does
 * for the mock/wix branches. The one narrow, accepted exception is
 * `account_locked`: an already-locked account gets a distinct message
 * (industry-standard tradeoff — see this phase's security review) rather
 * than being folded into `invalid_credentials`, since a lockout only ever
 * follows a real prior authentication attempt against that email, not a
 * blind guess.
 *
 * Reads `services/*` against DATA_ADAPTER (mock vs. wix), not AUTH_ADAPTER
 * — identical to how identityService/passwordService/etc. are called
 * everywhere else. AUTH_ADAPTER only decides *which* login system runs.
 *
 * MFA is deferred here: an identity with `mfaEnabled: true` cannot
 * complete login through this single-step form post today — it redirects
 * with `mfa_required` rather than granting a session. The two-step
 * challenge flow (code entry after password) is UI/route work that
 * doesn't fit a plain form-post model and belongs to the dedicated
 * `/api/auth/*` routes and login UI (see ROADMAP.md's Phase 21 entry) —
 * tracked as a known limitation, not silently ignored.
 */
async function handleIdentityLogin(
  email: string,
  password: string,
  rememberDevice: boolean,
  next: string,
  nextParam: string,
): Promise<void> {
  const dataAdapterMode = getDataAdapterMode();
  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = requestHeaders.get('user-agent');
  const idFactory = () => crypto.randomUUID();

  let identity = await findIdentityByEmail(email, dataAdapterMode);
  if (identity) {
    await unlockIfExpired(identity.id, dataAdapterMode);
    identity = await getIdentityById(identity.id, dataAdapterMode);
  }

  if (identity?.status === 'locked') {
    await recordLoginActivity({ identityId: identity.id, eventType: 'login_failed', ipAddress, userAgent, idFactory }, dataAdapterMode);
    redirect(`/login?error=account_locked&next=${nextParam}`);
  }

  const passwordValid = identity ? await verifyPassword(identity.id, password, dataAdapterMode) : false;
  if (!identity || !passwordValid) {
    await recordLoginActivity({ identityId: identity?.id ?? null, eventType: 'login_failed', ipAddress, userAgent, idFactory }, dataAdapterMode);
    if (identity) await checkAndApplyLockout(identity.id, dataAdapterMode);
    redirect(`/login?error=invalid_credentials&next=${nextParam}`);
  }

  if (identity.status === 'pending') {
    redirect(`/login?error=email_verification_required&next=${nextParam}`);
  }
  if (identity.status !== 'active') {
    redirect(`/login?error=invalid_credentials&next=${nextParam}`);
  }

  if (identity.mfaEnabled) {
    redirect(`/login?error=mfa_required&next=${nextParam}`);
  }

  await recordLoginActivity({ identityId: identity.id, eventType: 'login_succeeded', ipAddress, userAgent, idFactory }, dataAdapterMode);
  await recordSuccessfulLogin(identity.id, dataAdapterMode);

  const identitySession = await createIdentitySession(
    {
      identityId: identity.id,
      deviceId: idFactory(),
      deviceName: userAgent,
      ipAddress,
      userAgent,
      rememberDevice,
      passwordVersionAtIssue: identity.passwordVersion,
      idFactory,
    },
    dataAdapterMode,
  );

  await createSession(
    { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' },
    identitySession.id,
  );
  redirect(next);
}
