import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { toDisplayName } from '@/utils/displayName';
import type { BadgeVariant } from '@/types/caseViewModel';
import type { StepperStage } from './StageStepper';
import { StageProgress } from './StageProgress';
import styles from './CaseHeader.module.css';
import {
  SLA_RESPONSIBLE_LABEL,
  SLA_STATUS_LABEL,
  describeDeadline,
  type CaseSlaEvaluation,
} from '@/domain/sla/slaMilestones';
import type { SlaStatus } from '@/types/sla';

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
  isArchived,
  caseDetailStageHeading,
  stageBadgeVariant,
  daysWaitingInStage,
  slaTargetLabel,
  isOverdue,
  stages,
  onStepClick,
  sla,
  actions,
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
  /** Archived case (2026-10) — shown as a status badge beside the stage,
      so the read-only state is stated, not inferred from missing controls. */
  isArchived?: boolean;
  caseDetailStageHeading: string;
  stageBadgeVariant: BadgeVariant;
  daysWaitingInStage: number;
  slaTargetLabel: string;
  isOverdue: boolean;
  /** Optional — when provided, the compact stage progress renders under the chip. */
  stages?: StepperStage[];
  onStepClick?: (index: number) => void;
  /** SLA tracking (2026-10): when present, the header shows business days
      in stage and the current SLA in place of the old per-stage target. */
  sla?: CaseSlaEvaluation | null;
  /** Case-level actions shown under the case's identity (Print Label,
      2026-10). Omitted → nothing renders. */
  actions?: React.ReactNode;
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
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
        <div className={styles.stageColumn}>
          {/* The badge is a SIBLING of the stage chip, not a child of it:
              `.stageChip > *` paints the navy stage pill, which would
              restyle anything placed inside. The row wraps, so a long
              stage label plus the badge never overflows on a phone. */}
          <div className={styles.statusRow}>
            <span className={styles.stageChip}>
              <Badge variant={stageBadgeVariant}>{caseDetailStageHeading}</Badge>
            </span>
            {isArchived && <span className={styles.archivedBadge}>Archived</span>}
          </div>
          {stages && onStepClick && (
            <StageProgress
              stages={stages}
              daysWaitingInStage={daysWaitingInStage}
              stageDetail={sla ? businessDaysInStageLabel(sla.businessDaysInStage) : undefined}
              onStepClick={onStepClick}
            />
          )}
          {sla ? (
            <CurrentSlaLine sla={sla} />
          ) : (
            <span className={`${styles.slaLine} ${isOverdue ? styles.slaOverdue : styles.slaNeutral}`}>
              {daysWaitingInStage}d in stage · target {slaTargetLabel}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function businessDaysInStageLabel(days: number | null): string | null {
  if (days === null) return null;
  return `${days} business day${days === 1 ? '' : 's'} in stage`;
}

/** Green on track, amber due soon / today, red overdue, neutral for a wait
    on someone else, an acknowledged exception, or a missing start date. */
export function slaTone(status: SlaStatus | null): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (status === 'on_track' || status === 'completed') return 'ok';
  if (status === 'due_soon' || status === 'due_today') return 'warn';
  if (status === 'overdue') return 'bad';
  return 'neutral';
}

/**
 * SLA tracking (2026-10). The case's current actionable SLA in one compact
 * line: "Current SLA: Hard Save · Due today · [Due Today]". A wait on
 * someone else keeps its overdue fact visible beside it.
 */
function CurrentSlaLine({ sla }: { sla: CaseSlaEvaluation }) {
  const current = sla.current;
  if (!current || !current.status) {
    return <span className={`${styles.slaLine} ${styles.slaNeutral}`}>No SLA due right now</span>;
  }
  const deadline = describeDeadline(current);
  const tone = slaTone(current.status);
  return (
    <span className={`${styles.slaLine} ${styles.slaNeutral}`} data-testid="current-sla">
      <span>
        Current SLA: <strong>{current.label}</strong>
        {deadline && current.state === 'active' ? ` · ${deadline}` : ''}
      </span>{' '}
      <span className={`${styles.slaPill} ${styles[`slaPill_${tone}`]}`}>{SLA_STATUS_LABEL[current.status]}</span>
      {current.overdue && current.status !== 'overdue' && <span className={`${styles.slaPill} ${styles.slaPill_bad}`}>Overdue</span>}
      {current.responsibleParty !== 'staff' && current.state === 'active' && (
        <span className={styles.slaParty}> · {SLA_RESPONSIBLE_LABEL[current.responsibleParty]}</span>
      )}
    </span>
  );
}
