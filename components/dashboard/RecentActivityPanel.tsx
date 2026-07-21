import styles from './RecentActivityPanel.module.css';

export type ActivityEntry = {
  who: string;
  what: string;
  when: string;
};

/**
 * The prototype's own activityFeed is static, decorative mock content, not
 * derived from real case activity (see services/__mocks__/fixtures.ts's
 * activityFeedFixtures) — this component just renders whatever it's given.
 */
export function RecentActivityPanel({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>Recent activity</div>
      <div className={styles.list}>
        {entries.map((entry, index) => (
          <div key={index} className={styles.row}>
            <div>
              <span className={styles.who}>{entry.who}</span>{' '}
              <span className={styles.what}>{entry.what}</span>
            </div>
            <div className={styles.when}>{entry.when}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
