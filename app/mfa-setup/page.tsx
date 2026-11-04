import { redirect } from 'next/navigation';
import { getSession, clearSessionPath } from '@/lib/auth/session';
import { resolveIdentitySession } from '@/lib/auth/resolveIdentitySession';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { getDataAdapterMode } from '@/lib/env';
import { logoutAction } from '@/app/login/actions';
import { MfaEnrollmentSetup } from '@/components/auth/MfaEnrollmentSetup';
import styles from '../login/page.module.css';

/**
 * MFA enrollment gate (2026-11). Where a staff member whose organization
 * requires two-factor authentication sets it up before using SOLIS. Outside
 * the portal layout on purpose: the portal refuses them until they enroll
 * (resolveMembershipAuthorizationContext). Needs a valid signed-in session —
 * the middleware sends anyone without one to /login. It only ever calls the
 * caller's own /api/auth/mfa/* endpoints; it shows no organization data.
 */
export default async function MfaSetupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = sanitizeRedirectPath(rawNext);
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.user.source !== 'identity') redirect(next);
  const resolved = await resolveIdentitySession(session, getDataAdapterMode());
  if (!resolved.valid) redirect(clearSessionPath(resolved.reason));
  if (resolved.identity.mfaEnabled) redirect(next);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>SOLIS</h1>
        <p className={styles.subtitle}>Your funeral home requires two-factor authentication. Set it up to continue.</p>
        <MfaEnrollmentSetup next={next} />
        <form action={logoutAction} style={{ marginTop: 16 }}>
          <button type="submit" className="sx-btn sx-btn-ghost">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
