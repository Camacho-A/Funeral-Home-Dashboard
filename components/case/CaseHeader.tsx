import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { BadgeVariant } from '@/types/caseViewModel';
import styles from './CaseHeader.module.css';

export function CaseHeader({
  caseNumber,
  decedentName,
  dateOfBirth,
  dateOfDeath,
  tagNumber,
  caseDetailStageHeading,
  stageBadgeVariant,
  daysWaitingInStage,
  slaTargetLabel,
  isOverdue,
}: {
  /** Phase 16B (Case Number Generation): the human-facing, always
      read-only identifier — displayed here instead of the internal id
      (a UUID in Wix mode), per "display the Case Number prominently near
      the top of the Case Details page." */
  caseNumber: string;
  decedentName: string;
  dateOfBirth: string;
  dateOfDeath: string;
  /** Manors launch-prep. Operational chain-of-custody tag — shown here,
      always read-only (editing happens in CaseInformationCard), only when
      one has actually been assigned. */
  tagNumber?: string | null;
  /** Conditional shipping/tracking (2026-09): `CaseViewModel.caseDetailStageHeading`
      — equal to `stageLabel` everywhere except the stage immediately before
      Completed, where it adapts to `returnMethod` ("Ready for Pickup"/
      "Ready for Shipping"/"Return of Cremated Remains"). See
      domain/cases/returnMethod.ts. */
  caseDetailStageHeading: string;
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
            DOB {dateOfBirth} · DOD {dateOfDeath} · Case #{caseNumber}
            {tagNumber ? ` · Tag #${tagNumber}` : ''}
          </div>
        </div>
        <div className={styles.stageColumn}>
          <Badge variant={stageBadgeVariant}>{caseDetailStageHeading}</Badge>
          <span className={`${styles.slaLine} ${isOverdue ? styles.slaOverdue : styles.slaNeutral}`}>
            {daysWaitingInStage}d in stage · target {slaTargetLabel}
          </span>
        </div>
      </div>
    </>
  );
}
