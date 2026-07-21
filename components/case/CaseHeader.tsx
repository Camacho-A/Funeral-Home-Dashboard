import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { BadgeVariant } from '@/types/caseViewModel';
import styles from './CaseHeader.module.css';

export function CaseHeader({
  id,
  decedentName,
  dateOfBirth,
  dateOfDeath,
  stageLabel,
  stageBadgeVariant,
  daysWaitingInStage,
  slaTargetLabel,
  isOverdue,
}: {
  id: string;
  decedentName: string;
  dateOfBirth: string;
  dateOfDeath: string;
  stageLabel: string;
  stageBadgeVariant: BadgeVariant;
  daysWaitingInStage: number;
  slaTargetLabel: string;
  isOverdue: boolean;
}) {
  return (
    <>
      <Link href="/dashboard" className={styles.backLink}>
        ← Back to Dashboard
      </Link>
      <div className={styles.row}>
        <div>
          <div className={styles.name}>{decedentName}</div>
          <div className={styles.meta}>
            DOB {dateOfBirth} · DOD {dateOfDeath} · Case #{id}
          </div>
        </div>
        <div className={styles.stageColumn}>
          <Badge variant={stageBadgeVariant}>{stageLabel}</Badge>
          <span className={`${styles.slaLine} ${isOverdue ? styles.slaOverdue : styles.slaNeutral}`}>
            {daysWaitingInStage}d in stage · target {slaTargetLabel}
          </span>
        </div>
      </div>
    </>
  );
}
