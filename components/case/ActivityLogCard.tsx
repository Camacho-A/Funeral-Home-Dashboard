import type { TimelineEntryViewModel } from '@/types/caseViewModel';
import { formatDaysAgo } from '@/utils/format';
import styles from './ActivityLogCard.module.css';

export function ActivityLogCard({
  timeline,
  onPrint,
}: {
  timeline: TimelineEntryViewModel[];
  onPrint: () => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.title}>Activity log</div>
        <button type="button" className={styles.printLink} onClick={onPrint}>
          Print
        </button>
      </div>
      <div className={styles.list}>
        {timeline.map((entry, index) => (
          <div key={index} className={styles.entry}>
            <div className={styles.dot} />
            <div>
              <div className={styles.what}>
                <span className={styles.who}>{entry.who}</span> {entry.what}
              </div>
              <div className={styles.when}>{formatDaysAgo(entry.daysAgo)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
