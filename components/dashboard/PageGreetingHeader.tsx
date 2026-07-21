import styles from './PageGreetingHeader.module.css';

/**
 * `todayLabel` is computed by the page (app/(portal)/dashboard/page.tsx),
 * not here — the prototype hardcodes a fake date ("Wednesday, July 15");
 * this shows the real current date instead (a deliberate, documented
 * deviation), computed client-side after mount to avoid baking a stale
 * build-time date into this statically-prerendered route.
 */
export function PageGreetingHeader({
  todayLabel,
  activeCount,
}: {
  todayLabel: string;
  activeCount: number;
}) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.title}>Good afternoon</div>
      <div className={styles.subtitle}>
        {todayLabel} · {activeCount} active cases
      </div>
    </div>
  );
}
