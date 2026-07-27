import { AuthFormLayout, authFormStyles as styles } from '@/components/auth/AuthFormLayout';
import { acceptInvitationAction } from './actions';

const ERROR_MESSAGES: Record<string, string> = {
  too_short: 'Password must be at least 8 characters.',
  mismatch: 'Passwords do not match.',
  invalid: 'This invitation link is invalid or has expired.',
};

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; membershipId?: string; error?: string }>;
}) {
  const { token, membershipId, error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.') : null;

  if (!token || !membershipId) {
    return <AuthFormLayout title="Accept invitation" subtitle="" error="This invitation link is missing required information." />;
  }

  return (
    <AuthFormLayout title="Accept invitation" subtitle="Set a password to finish joining your organization." error={errorMessage}>
      <form action={acceptInvitationAction} className={styles.form}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="membershipId" value={membershipId} />
        <label className={styles.label}>
          Password
          <input type="password" name="password" required minLength={8} autoComplete="new-password" className={styles.input} />
        </label>
        <label className={styles.label}>
          Confirm password
          <input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" className={styles.input} />
        </label>
        <button type="submit" className={styles.submit}>Set password and continue</button>
      </form>
    </AuthFormLayout>
  );
}
