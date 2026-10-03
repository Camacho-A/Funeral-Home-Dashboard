import styles from './StageStepper.module.css';

export type StepperStage = {
  label: string;
  done: boolean;
  current: boolean;
  /** Viewable (clickable to see its checklist read-only) only if the case has reached it. */
  viewable: boolean;
};

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
            title={stage.label}
            aria-current={stage.current ? 'step' : undefined}
          >
            <span
              className={`${styles.dot} ${stage.done ? styles.dotDone : stage.current ? styles.dotCurrent : styles.dotUpcoming}`}
            >
              {stage.done ? '✓' : index + 1}
            </span>
            <span className={`${styles.label} ${stage.current ? styles.labelCurrent : styles.labelOther}`}>
              {stage.label}
            </span>
          </button>
          {index < stages.length - 1 && (
            <div className={`${styles.connector} ${stage.done ? styles.connectorDone : styles.connectorUpcoming}`} aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}
