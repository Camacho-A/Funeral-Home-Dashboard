import { AuthFormLayout, authFormStyles as styles } from '@/components/auth/AuthFormLayout';
import { forgotPasswordAction } from './actions';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  if (sent) {
    return (
      <AuthFormLayout
        title="Check your email"
        subtitle=""
        message="If an account exists for that email, a password reset link has been sent."
      >
        {process.env.NODE_ENV !== 'production' && (
          <p className={styles.hint}>
            Development mode — no transactional email provider is configured. If an account existed, the reset
            link was logged to the server console instead of being emailed.
          </p>
        )}
        <p className={styles.hint}>
          <a className={styles.hintLink} href="/login">Back to sign in</a>
        </p>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout title="Forgot password" subtitle="Enter your email and we'll send you a reset link.">
      <form action={forgotPasswordAction} className={styles.form}>
        <label className={styles.label}>
          Email
          <input type="email" name="email" required autoComplete="email" className={styles.input} />
        </label>
        <button type="submit" className={styles.submit}>Send reset link</button>
      </form>
      <p className={styles.hint}>
        <a className={styles.hintLink} href="/login">Back to sign in</a>
      </p>
    </AuthFormLayout>
  );
}
