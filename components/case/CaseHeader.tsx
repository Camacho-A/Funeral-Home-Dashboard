import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { toDisplayName } from '@/utils/displayName';
import type { BadgeVariant } from '@/types/caseViewModel';
import type { StepperStage } from './StageStepper';
import { StageProgress } from './StageProgress';
import styles from './CaseHeader.module.css';

/**
 * Case Detail header — SOLIS Phase 3 (presentation only). Meta text is
 * unchanged (tests match "Case #…" / "Tag #…"). New, OPTIONAL `weight` /
 * `weightOver200` props show a facts-line weight with the existing
 * over-200 lb flag; omitted → nothing renders, so other callers/tests are
 * unaffected. Back link reads "← Cases" → existing /cases route.
 */
export function CaseHeader({
  caseNumber,
  decedentName,
  dateOfBirth,
  dateOfDeath,
  tagNumber,
  weight,
  weightOver200,
  isMedicalExaminerCase,
  caseDetailStageHeading,
  stageBadgeVariant,
  daysWaitingInStage,
  slaTargetLabel,
  isOverdue,
  stages,
  onStepClick,
}: {
  caseNumber: string;
  decedentName: string;
  dateOfBirth: string;
  dateOfDeath: string;
  tagNumber?: string | null;
  weight?: string | number | null;
  weightOver200?: boolean;
  /** Medical Examiner case (2026-10) — shown as a header flag. */
  isMedicalExaminerCase?: boolean;
  caseDetailStageHeading: string;
  stageBadgeVariant: BadgeVariant;
  daysWaitingInStage: number;
  slaTargetLabel: string;
  isOverdue: boolean;
  /** Optional — when provided, the compact stage progress renders under the chip. */
  stages?: StepperStage[];
  onStepClick?: (index: number) => void;
}) {
  const hasWeight = weight !== undefined && weight !== null && String(weight).trim() !== '';
  const weightText = hasWeight ? (/lb/i.test(String(weight)) ? String(weight) : `${weight} lb`) : '';

  return (
    <>
      <Link href="/cases" className={styles.backLink}>
        ← Cases
      </Link>
      <div className={styles.row}>
        <div className={styles.identity}>
          <div className={styles.name}>{toDisplayName(decedentName)}</div>
          <div className={styles.meta}>
            DOB {dateOfBirth} · DOD {dateOfDeath} · Case #{caseNumber}
            {tagNumber ? ` · Tag #${tagNumber}` : ''}
          </div>
          {/* The facts line carries handling flags, so it appears when there
              is any flag to carry — not only when a weight was recorded. An
              ME case with no weight yet still needs its notice. */}
          {(hasWeight || isMedicalExaminerCase) && (
            <div className={styles.facts}>
              {hasWeight && (
                <span className={styles.fact}>
                  Weight{' '}
                  <span className={weightOver200 ? styles.weightOver : styles.weightNormal}>{weightText}</span>
                </span>
              )}
              {weightOver200 && <span className={styles.weightFlag}>Over 200 lb</span>}
              {/* Medical Examiner classification (2026-10). Alongside the
                  weight flag, because it is the same kind of fact: a
                  property of the case that changes how staff handle it,
                  and that they should not have to scroll to discover. */}
              {isMedicalExaminerCase && <span className={styles.meFlag}>Medical Examiner Case</span>}
            </div>
          )}
        </div>
        <div className={styles.stageColumn}>
          <span className={styles.stageChip}>
            <Badge variant={stageBadgeVariant}>{caseDetailStageHeading}</Badge>
          </span>
          {stages && onStepClick && (
            <StageProgress stages={stages} daysWaitingInStage={daysWaitingInStage} onStepClick={onStepClick} />
          )}
          <span className={`${styles.slaLine} ${isOverdue ? styles.slaOverdue : styles.slaNeutral}`}>
            {daysWaitingInStage}d in stage · target {slaTargetLabel}
          </span>
        </div>
      </div>
    </>
  );
}
