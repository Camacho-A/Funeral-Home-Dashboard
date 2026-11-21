import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { submitPortalMfaSetupCode } from '../actions';
import styles from '../page.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: 'That setup code was not correct, has expired, or was already used. Ask an administrator for a new one.',
};

/**
 * Portal-scoped MFA (Phase 5N follow-up). Reached only after a correct
 * password, by someone whose two-step verification was set up in another
 * SOLIS portal. They enter the one-time setup code an administrator issued
 * for this portal, then set up an authenticator here. Their other portal's
 * two-step verification is not changed.
 */
export default async function PortalMfaSetupCodePage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next: rawNext, error } = await searchParams;
  const next = sanitizeRedirectPath(rawNext);
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.') : null;
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>SOLIS</h1>
        <p className={styles.subtitle}>Set up two-step verification for this portal.</p>
        <p className={styles.hint}>
          Your two-step verification was set up in another SOLIS portal. It keeps working there. To use this portal, enter the one-time setup code an administrator gave you, then
          connect your authenticator app here.
        </p>
        {errorMessage && (
          <div className={styles.error} role="alert">
            {errorMessage}
          </div>
        )}
        <form action={submitPortalMfaSetupCode} className={styles.form}>
          <input type="hidden" name="next" value={next} />
          <label className={styles.label}>
            One-time setup code
            <input type="text" name="code" required autoComplete="off" autoFocus className={styles.input} placeholder="XXXX-XXXX-XXXX" />
          </label>
          <button type="submit" className={styles.submit}>
            Continue
          </button>
        </form>
        <p className={styles.hint}>
          <a className={styles.hintLink} href="/login">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
