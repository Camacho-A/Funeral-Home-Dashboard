import styles from './AuthFormLayout.module.css';

/**
 * Phase 21 (Identity, Authentication & Session Management). The shared
 * card/title/subtitle/message chrome for the four new public identity
 * pages (Forgot Password, Reset Password, Verify Email, Accept
 * Invitation) — a deliberate small extraction rather than duplicating
 * app/login/page.module.css's own layout four times over: unlike
 * app/login/page.tsx (a Phase 13 file this phase leaves untouched), these
 * four pages are new and genuinely share this exact shape immediately,
 * not speculatively.
 */
export function AuthFormLayout({
  title,
  subtitle,
  error,
  message,
  children,
}: {
  title: string;
  subtitle: string;
  error?: string | null;
  message?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className={styles.success} role="status">
            {message}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

export { styles as authFormStyles };
