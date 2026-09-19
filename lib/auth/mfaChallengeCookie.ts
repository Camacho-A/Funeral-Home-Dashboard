import { cookies } from 'next/headers';
import { MFA_CHALLENGE_COOKIE_NAME } from './mfaChallengeToken';

/**
 * Phase 40 (MFA & Account Security). Server-only helpers to set/read/clear the
 * short-lived `beacon_mfa_challenge` cookie that carries the MFA-pending token
 * between the password step and the second-factor step. httpOnly + sameSite
 * lax + secure-in-prod, exactly like the real session cookie, but with a brief
 * 5-minute max-age. This cookie is never accepted as authentication by any
 * protected route — only the `/login/mfa` challenge action reads it.
 */
const CHALLENGE_MAX_AGE_SECONDS = 5 * 60;

function challengeCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: CHALLENGE_MAX_AGE_SECONDS,
  };
}

export async function setMfaChallengeCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(MFA_CHALLENGE_COOKIE_NAME, token, challengeCookieOptions());
}

export async function readMfaChallengeCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(MFA_CHALLENGE_COOKIE_NAME)?.value ?? null;
}

export async function clearMfaChallengeCookie(): Promise<void> {
  const store = await cookies();
  store.delete(MFA_CHALLENGE_COOKIE_NAME);
}
