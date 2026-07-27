import { AuthFormLayout, authFormStyles as styles } from '@/components/auth/AuthFormLayout';
import { verifyEmailAction } from './actions';

/**
 * Phase 21 (Identity, Authentication & Session Management). Deliberately
 * requires an explicit button click rather than auto-verifying on render —
 * verifyEmailWithToken marks the token single-use, and email clients
 * sometimes prefetch links; an auto-verify-on-load page would burn the
 * token before the person ever saw it (the same "link-prefetching" risk
 * services/passwordService.ts's own resetPasswordWithToken comment already
 * calls out for reset links).
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; verified?: string; error?: string }>;
}) {
  const { token, verified, error } = await searchParams;

  if (verified) {
    return (
      <AuthFormLayout title="Email verified" subtitle="" message="Your email has been verified.">
        <p className={styles.hint}>
          <a className={styles.hintLink} href="/login">Continue to sign in</a>
        </p>
      </AuthFormLayout>
    );
  }

  if (!token) {
    return <AuthFormLayout title="Verify email" subtitle="" error="This verification link is missing its token." />;
  }

  return (
    <AuthFormLayout
      title="Verify email"
      subtitle="Confirm your email address to finish setting up your account."
      error={error ? 'This verification link is invalid or has expired.' : null}
    >
      <form action={verifyEmailAction} className={styles.form}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={styles.submit}>Verify my email</button>
      </form>
    </AuthFormLayout>
  );
}
