import styles from './EmptyState.module.css';

/**
 * Minimal version per the Frontend Engineering Plan — matches the prototype's
 * one literal instance exactly (a plain "No cases match ..." text line, see
 * docs/UI_COMPONENTS.md). Deliberately not yet the fuller icon + guidance +
 * CTA pattern Beacon-Design-System.md Section 14 describes — that's an
 * enrichment for a later phase, once a second real instance justifies it.
 */
export function EmptyState({ message }: { message: string }) {
  return <div className={styles.emptyState}>{message}</div>;
}
