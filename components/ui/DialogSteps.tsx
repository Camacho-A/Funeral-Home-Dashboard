import styles from './DialogSteps.module.css';

/**
 * UI refresh (2026-11): the numbered step band under a dialog's header —
 * done steps show ✓, the current one is filled navy, later ones are
 * outlined. The same look as Fax DC Applications; presentation only.
 */
export function DialogSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className={styles.steps} aria-label="Steps">
      {steps.map((label, i) => (
        <li key={label} className={`${styles.item} ${i === current ? styles.current : ''} ${i < current ? styles.done : ''}`} aria-current={i === current ? 'step' : undefined}>
          <span className={styles.number} aria-hidden="true">
            {i < current ? '✓' : i + 1}
          </span>
          <span className={styles.label}>
            <span className={styles.srOnly}>
              Step {i + 1} of {steps.length}:{' '}
            </span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
