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
import { verifyMfaCode, verifyAndConsumeRecoveryCode } from '@/services/mfaService';
import { createMfaChallengeToken, verifyMfaChallengeToken } from '@/lib/auth/mfaChallengeToken';
import { setMfaChallengeCookie, readMfaChallengeCookie, clearMfaChallengeCookie } from '@/lib/auth/mfaChallengeCookie';
import { identityMustEnrollMfa } from '@/services/mfaPolicyService';

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
    await handleIdentityLogin(email, password, next, nextParam);
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

  // Phase 40: MFA challenge. A correct password alone must NOT create a
  // session when MFA is required. Issue a short-lived, non-session
  // "challenge pending" token and hand off to the second-factor step; the
  // real IdentitySession is minted only after the factor verifies.
  if (identity.mfaEnabled) {
    const challengeToken = await createMfaChallengeToken({
      identityId: identity.id,
      passwordVersionAtIssue: identity.passwordVersion,
    });
    await setMfaChallengeCookie(challengeToken);
    redirect(`/login/mfa?next=${nextParam}`);
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
      passwordVersionAtIssue: identity.passwordVersion,
      idFactory,
    },
    dataAdapterMode,
  );

  await createSession(
    { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' },
    identitySession.id,
  );
  // Phase 40 org require-MFA enforcement: a member of a require-MFA org who
  // isn't enrolled is routed to enrollment (never hard-locked out).
  if (await identityMustEnrollMfa(identity, dataAdapterMode)) {
    redirect('/settings/security?notice=mfa_setup_required');
  }
  redirect(next);
}

/**
 * Phase 40 (MFA & Account Security). The second step of an MFA login. Reads the
 * short-lived challenge cookie, re-validates it against the current identity
 * state, verifies the submitted TOTP code OR a single-use recovery code, and
 * only then mints the real IdentitySession. A wrong code counts toward the
 * same persistent account lockout as a wrong password. The challenge token is
 * never accepted as authentication anywhere else.
 */
export async function submitMfaChallenge(formData: FormData): Promise<void> {
  const rawNext = typeof formData.get('next') === 'string' ? (formData.get('next') as string) : '/';
  const next = sanitizeRedirectPath(rawNext);
  const nextParam = encodeURIComponent(next);
  const code = typeof formData.get('code') === 'string' ? (formData.get('code') as string).trim() : '';
  const useRecoveryCode = formData.get('useRecoveryCode') === 'on' || formData.get('useRecoveryCode') === 'true';

  const dataAdapterMode = getDataAdapterMode();
  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = requestHeaders.get('user-agent');
  const idFactory = () => crypto.randomUUID();

  const challengeCookie = await readMfaChallengeCookie();
  const challenge = challengeCookie ? await verifyMfaChallengeToken(challengeCookie) : null;
  if (!challenge) {
    await clearMfaChallengeCookie();
    redirect(`/login?error=mfa_challenge_expired&next=${nextParam}`);
  }

  let identity = await getIdentityById(challenge.identityId, dataAdapterMode);
  if (identity) {
    await unlockIfExpired(identity.id, dataAdapterMode);
    identity = await getIdentityById(identity.id, dataAdapterMode);
  }
  // The identity must still exist, still have MFA on, and its password must
  // not have changed since the challenge was issued.
  if (!identity || !identity.mfaEnabled || identity.passwordVersion !== challenge.passwordVersionAtIssue) {
    await clearMfaChallengeCookie();
    redirect(`/login?error=mfa_challenge_expired&next=${nextParam}`);
  }
  if (identity.status === 'locked') {
    await clearMfaChallengeCookie();
    redirect(`/login?error=account_locked&next=${nextParam}`);
  }
  if (identity.status !== 'active') {
    await clearMfaChallengeCookie();
    redirect(`/login?error=mfa_challenge_expired&next=${nextParam}`);
  }
  if (code.length === 0) {
    redirect(`/login/mfa?error=invalid_code&next=${nextParam}`);
  }

  const factorOk = useRecoveryCode
    ? await verifyAndConsumeRecoveryCode(identity.id, code, dataAdapterMode)
    : await verifyMfaCode(identity.id, code, dataAdapterMode);

  if (!factorOk) {
    await recordLoginActivity({ identityId: identity.id, eventType: 'login_failed', ipAddress, userAgent, idFactory }, dataAdapterMode);
    const { locked } = await checkAndApplyLockout(identity.id, dataAdapterMode);
    if (locked) {
      await clearMfaChallengeCookie();
      redirect(`/login?error=account_locked&next=${nextParam}`);
    }
    redirect(`/login/mfa?error=invalid_code&next=${nextParam}`);
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
      passwordVersionAtIssue: identity.passwordVersion,
      idFactory,
    },
    dataAdapterMode,
  );
  await createSession(
    { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' },
    identitySession.id,
  );
  await clearMfaChallengeCookie();
  redirect(next);
}
