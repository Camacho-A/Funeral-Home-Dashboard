import styles from './StageStepper.module.css';

export type StepperStage = {
  label: string;
  done: boolean;
  current: boolean;
  /** Viewable (clickable to see its checklist read-only) only if the case has reached it. */
  viewable: boolean;
  /** True earlier-stage status (2026-10, Manors): a passed stage with this
      many required steps still unchecked shows amber with the count,
      instead of a green ✓. Absent or 0 → the usual done state. */
  incompleteSteps?: number;
};

/** Accessible and tooltip wording for a stage (2026-10). */
export function stageStatusText(stage: StepperStage): string {
  const incomplete = stage.done ? (stage.incompleteSteps ?? 0) : 0;
  if (incomplete > 0) return `Passed — ${incomplete} ${incomplete === 1 ? 'step' : 'steps'} not checked`;
  if (stage.done) return 'Passed — all steps checked';
  if (stage.current) return 'Current stage';
  return 'Upcoming';
}

export function stageIsIncomplete(stage: StepperStage): boolean {
  return stage.done && (stage.incompleteSteps ?? 0) > 0;
}

/**
 * Purely presentational stage stepper. SOLIS Phase 3: compact full-width
 * row (no card, no horizontal scrollbar, no cut-off last stage). Labels
 * truncate with an ellipsis; the full label is available as a tooltip
 * (`title`) and to assistive tech (`aria-label`). Click behavior unchanged.
 */
export function StageStepper({
  stages,
  onStepClick,
}: {
  stages: StepperStage[];
  onStepClick: (index: number) => void;
}) {
  return (
    <ol className={styles.stepper} aria-label="Workflow stages">
      {stages.map((stage, index) => (
        <li key={stage.label} className={`${styles.stage} ${index < stages.length - 1 ? styles.stageWithConnector : ''}`}>
          <button
            type="button"
            className={`${styles.stepButton} ${stage.viewable ? styles.stepButtonViewable : styles.stepButtonDisabled}`}
            onClick={stage.viewable ? () => onStepClick(index) : undefined}
            disabled={!stage.viewable}
            title={`${stage.label} — ${stageStatusText(stage)}`}
            aria-label={`${stage.label}: ${stageStatusText(stage)}`}
            aria-current={stage.current ? 'step' : undefined}
          >
            <span
              className={`${styles.dot} ${
                stageIsIncomplete(stage) ? styles.dotIncomplete : stage.done ? styles.dotDone : stage.current ? styles.dotCurrent : styles.dotUpcoming
              }`}
              aria-hidden="true"
            >
              {stageIsIncomplete(stage) ? stage.incompleteSteps : stage.done ? '✓' : index + 1}
            </span>
            <span className={`${styles.label} ${stage.current ? styles.labelCurrent : styles.labelOther}`}>
              {stage.label}
            </span>
          </button>
          {index < stages.length - 1 && (
            <div
              className={`${styles.connector} ${stageIsIncomplete(stage) ? styles.connectorIncomplete : stage.done ? styles.connectorDone : styles.connectorUpcoming}`}
              aria-hidden="true"
            />
          )}
        </li>
      ))}
    </ol>
  );
}
