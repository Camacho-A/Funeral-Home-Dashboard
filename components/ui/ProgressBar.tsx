import styles from './ProgressBar.module.css';

/**
 * Case progress indicator (Case list scalability, Phase 3 — progress
 * indicator addition, 2026-09). Generic/reusable — `percent` is the only
 * thing this component knows about; what it means (overall checklist
 * completion across a case's workflow, not its current-stage position)
 * is decided by the caller — see domain/cases/progress.ts.
 *
 * Accessible by construction: `role="progressbar"` with
 * `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, and the numeric
 * percentage is always rendered as real text (`aria-hidden` only on the
 * decorative bar itself) — never communicated by color/width alone.
 */
export function ProgressBar({ percent, label = 'Progress' }: { percent: number; label?: string }) {
  // Defensive clamp — the canonical calculation (domain/cases/progress.ts)
  // already guarantees 0-100, but this component makes no assumption
  // about its caller and never renders outside that range regardless.
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={styles.fill} style={{ width: `${clamped}%` }} aria-hidden="true" />
      </div>
      <span className={styles.text}>{clamped}% Complete</span>
    </div>
  );
}
