import { AuthFormLayout, authFormStyles as styles } from '@/components/auth/AuthFormLayout';
import { resetPasswordAction } from './actions';

const ERROR_MESSAGES: Record<string, string> = {
  too_short: 'Password must be at least 8 characters.',
  mismatch: 'Passwords do not match.',
  invalid: 'This reset link is invalid or has expired.',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.') : null;

  if (!token) {
    return (
      <AuthFormLayout title="Reset password" subtitle="" error="This reset link is missing its token.">
        <p className={styles.hint}>
          <a className={styles.hintLink} href="/forgot-password">Request a new reset link</a>
        </p>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout title="Reset password" subtitle="Choose a new password." error={errorMessage}>
      <form action={resetPasswordAction} className={styles.form}>
        <input type="hidden" name="token" value={token} />
        <label className={styles.label}>
          New password
          <input type="password" name="newPassword" required minLength={8} autoComplete="new-password" className={styles.input} />
        </label>
        <label className={styles.label}>
          Confirm new password
          <input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" className={styles.input} />
        </label>
        <button type="submit" className={styles.submit}>Reset password</button>
      </form>
    </AuthFormLayout>
  );
}
