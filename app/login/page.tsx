import { getAuthAdapterMode } from '@/lib/env';
import { MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD } from '@/services/__mocks__/authFixtures';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { ProductBrand } from '@/components/layout/ProductBrand';
import { loadLoginOrganization } from './branding';
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
  // Phase 21 (Identity, Authentication & Session Management) — from
  // app/login/actions.ts's identity branch and
  // lib/auth/resolveIdentitySession.ts (via app/(portal)/layout.tsx).
  account_locked: 'Too many failed attempts. Your account is temporarily locked — try again in a few minutes.',
  mfa_required: 'Multi-factor authentication is required for this account.',
  mfa_challenge_expired: 'Your verification step expired. Please sign in again.',
  revoked: 'This session was signed out. Please sign in again.',
  expired: 'Your session has expired. Please sign in again.',
  password_changed: 'Your password was recently changed. Please sign in again.',
  session_not_found: 'Your session is no longer valid. Please sign in again.',
  identity_not_active: 'Your account is not currently active.',
  unknown: 'Something went wrong. Please try again.',
};

const NOTICE_MESSAGES: Record<string, string> = {
  password_reset: 'Your password has been reset. Please sign in.',
  invitation_accepted: 'Your account is ready. Please sign in.',
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
 *
 * Task #13 (2026-09, SOLIS product branding): the heading now renders
 * `<ProductBrand>` (components/layout/ProductBrand.tsx) instead of plain
 * "SOLIS" text — the same [SolisCode mark] SOLIS lockup the Sidebar uses.
 * `<h1>` still wraps it, so this remains the page's one accessible
 * heading; the mark is decorative (`alt=""`), so its accessible name is
 * still exactly "SOLIS". No authentication/form/validation behavior
 * changed.
 *
 * Login page branding refinement (2026-10). SOLIS leads: its lockup and
 * "Built with Balance." sit at the top of the card as the primary
 * identity, with the organization's own branding below a divider as the
 * secondary "which workspace is this" signal — the organization logo used
 * to dominate, which inverted the hierarchy of a product sign-in screen.
 * A quiet "Powered by SOLIS" closes the card.
 *
 * SOLIS remains the `<h1>`: the organization block is additive, sits
 * outside the heading, and never becomes the page's accessible name.
 *
 * Which organization is resolved from the DEPLOYMENT — its hostname map
 * or its single-tenant configuration — never from user input, and never
 * by inference (see ./branding.ts and domain/organization/loginBranding.ts).
 * A generic SOLIS login, or any failure resolving branding, renders the
 * SOLIS half of the card alone and no tenant's logo.
 *
 * Nothing about authentication, validation, error/notice messaging, the
 * form, or the password-reset link changes here — this is layout only.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const { next: rawNext, error, notice } = await searchParams;
  const next = sanitizeRedirectPath(rawNext);
  const authAdapter = getAuthAdapterMode();
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown) : null;
  const organization = await loadLoginOrganization();
  const noticeMessage = !errorMessage && notice ? NOTICE_MESSAGES[notice] : null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          <ProductBrand markSize={40} className={styles.brandLockup} />
        </h1>
        <p className={styles.tagline}>Built with Balance.</p>

        {organization && (
          <div className={styles.organization}>
            {organization.logoUrl && (
              <span className={styles.organizationLogoFrame}>
                {/* A remote, operator-uploaded asset of unknown dimensions —
                    next/image has no precedent here and buys nothing (see
                    ProductBrand's own identical note). `alt=""` because the
                    workspace line directly below carries the same
                    information as real text; announcing the organization
                    twice helps nobody. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={organization.logoUrl} alt="" className={styles.organizationLogo} />
              </span>
            )}
            <span className={styles.organizationName}>{organization.name} Workspace</span>
          </div>
        )}

        <p className={styles.subtitle}>Sign in to continue.</p>

        {errorMessage && (
          <div className={styles.error} role="alert">
            {errorMessage}
          </div>
        )}
        {noticeMessage && (
          <div className={styles.success} role="status">
            {noticeMessage}
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
            {authAdapter === 'wix' ? 'Sign in with Wix' : authAdapter === 'identity' ? 'Sign In' : 'Sign In (Development)'}
          </button>
        </form>

        {authAdapter === 'identity' && (
          <p className={styles.hint}>
            <a className={styles.hintLink} href="/forgot-password">Forgot password?</a>
          </p>
        )}
        {authAdapter === 'mock' && (
          <p className={styles.hint}>
            Mock mode — sign in with {MOCK_LOGIN_EMAIL} / {MOCK_LOGIN_PASSWORD}
          </p>
        )}

        {/* Deliberately the quietest thing on the card — the primary SOLIS
            identity is the lockup at the top, and this must not compete
            with it. */}
        <p className={styles.poweredBy}>Powered by SOLIS</p>
      </div>
    </div>
  );
}
