import { getAuthAdapterMode } from '@/lib/env';
import { MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD } from '@/services/__mocks__/authFixtures';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { loginAction } from './actions';
import styles from './page.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Invalid email or password.',
  email_verification_required: 'Please verify your email before signing in.',
  owner_approval_required: 'Your account is pending approval.',
  // From lib/auth/authorize.ts, via app/(portal)/layout.tsx — deliberately
  // as non-specific as the login-failure messages above, for the same
  // reason: this shouldn't tell a signed-in-but-unauthorized visitor
  // anything about which organizations exist or who belongs to them.
  no_active_membership: 'Your account is not currently associated with an organization.',
  organization_mismatch: 'Your account is not currently associated with an organization.',
  selection_required: 'Your account belongs to more than one organization. Contact an administrator.',
  unknown: 'Something went wrong. Please try again.',
};

/**
 * Phase 13 (Authentication & Organizations). A plain Server Component
 * form — no Client Component, no client-side JS required to submit —
 * posting directly to a Server Action (app/login/actions.ts). This is
 * deliberate: there is no authentication or authorization logic in this
 * file at all, only markup and a generic error-message lookup, keeping
 * that logic entirely server-side per "keep authentication and
 * authorization logic out of presentational React components."
 *
 * Renders identically in shape regardless of AUTH_ADAPTER; only the
 * button label and the mock-credentials hint change. In both modes the
 * same email/password fields post to the same action, which is what
 * branches on the adapter — the form itself doesn't need to know.
 *
 * Phase 15A.1 (Auth/Data Adapter Separation): branches on AUTH_ADAPTER,
 * not DATA_ADAPTER — this page's appearance no longer depends on which
 * backend `services/*` happen to be reading/writing against.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = sanitizeRedirectPath(rawNext);
  const authAdapter = getAuthAdapterMode();
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown) : null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Beacon</h1>
        <p className={styles.subtitle}>Sign in to continue.</p>

        {errorMessage && (
          <div className={styles.error} role="alert">
            {errorMessage}
          </div>
        )}

        <form action={loginAction} className={styles.form}>
          <input type="hidden" name="next" value={next} />
          <label className={styles.label}>
            Email
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className={styles.input}
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className={styles.input}
            />
          </label>
          <button type="submit" className={styles.submit}>
            {authAdapter === 'wix' ? 'Sign in with Wix' : 'Sign In (Development)'}
          </button>
        </form>

        {authAdapter === 'mock' && (
          <p className={styles.hint}>
            Mock mode — sign in with {MOCK_LOGIN_EMAIL} / {MOCK_LOGIN_PASSWORD}
          </p>
        )}
      </div>
    </div>
  );
}
