import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { submitMfaChallenge } from '../actions';
import styles from '../page.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: 'That code was not correct. Please try again.',
};

/**
 * Phase 40 (MFA & Account Security). The second step of an MFA login — a plain
 * Server Component form posting to the `submitMfaChallenge` Server Action.
 * Reachable only after a correct password (the action reads the short-lived
 * challenge cookie; without it, it redirects back to /login). No authentication
 * logic lives here — only markup and a generic error lookup. The user enters
 * their authenticator code, or toggles to enter a single-use recovery code.
 */
export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = sanitizeRedirectPath(rawNext);
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.') : null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Beacon</h1>
        <p className={styles.subtitle}>Enter your verification code.</p>

        {errorMessage && (
          <div className={styles.error} role="alert">
            {errorMessage}
          </div>
        )}

        <form action={submitMfaChallenge} className={styles.form}>
          <input type="hidden" name="next" value={next} />
          <label className={styles.label}>
            Authentication code
            <input
              type="text"
              name="code"
              required
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              className={styles.input}
              aria-label="Authentication or recovery code"
            />
          </label>
          <label className={styles.label}>
            <input type="checkbox" name="useRecoveryCode" /> Use a recovery code instead
          </label>
          <button type="submit" className={styles.submit}>Verify</button>
        </form>

        <p className={styles.hint}>
          <a className={styles.hintLink} href="/login">Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
