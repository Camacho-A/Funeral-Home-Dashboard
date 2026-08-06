import styles from './FamilyAuthCard.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). The shared shell for
 * every public, unauthenticated `/family/*` page (login, accept-invitation,
 * forgot/reset password) — mirrors `app/login/page.module.css`'s own card
 * layout, adapted with `max-width: 100%` (instead of a `90vw` cap) and
 * page-level padding so it degrades gracefully on a small phone screen,
 * consistent with the Family Portal being mobile-first where the staff
 * app is deliberately desktop-only.
 */
export function FamilyAuthCard({
  title,
  subtitle,
  error,
  success,
  children,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  success?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className={styles.success} role="status">
            {success}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
