import { Checkbox } from '@/components/ui/Checkbox';
import type { VaStepViewModel } from '@/types/caseViewModel';
import type { VaPublishChoice } from '@/types/case';
import styles from './VaNotificationPanel.module.css';

/**
 * Shown inside CaseInformationCard when a case is flagged as a veteran.
 * `vaCallbackDone` (step index 1) gates whether the publish/private choice
 * appears, matching design/support.js's isVaCallbackDone exactly.
 */
export function VaNotificationPanel({
  vaSteps,
  vaCallbackDone,
  vaPublishChoice,
  onToggleStep,
  onSetPublishChoice,
}: {
  vaSteps: VaStepViewModel[];
  vaCallbackDone: boolean;
  vaPublishChoice: VaPublishChoice | null;
  onToggleStep: (index: number, newDone: boolean) => void;
  onSetPublishChoice: (choice: VaPublishChoice) => void;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.title}>VA notification</div>
      {vaSteps.map((step) => (
        <div
          key={step.index}
          className={`${styles.step} ${!step.locked ? styles.stepClickable : ''}`}
          onClick={step.locked ? undefined : () => onToggleStep(step.index, !step.done)}
        >
          <Checkbox
            checked={step.done}
            disabled={step.locked}
            onChange={step.locked ? undefined : () => onToggleStep(step.index, !step.done)}
            tone={step.done ? 'success' : 'brand'}
            size="sm"
            aria-label={step.label}
          />
          <span className={`${styles.stepLabel} ${step.locked ? styles.stepLabelLocked : styles.stepLabelActive}`}>
            {step.label}
          </span>
        </div>
      ))}

      {vaCallbackDone && (
        <div className={styles.publishSection}>
          <div className={styles.publishPrompt}>Publish the service, or keep it private?</div>
          <div className={styles.publishButtons}>
            <button
              type="button"
              className={`${styles.publishButton} ${vaPublishChoice === 'publish' ? styles.publishButtonActive : styles.publishButtonInactive}`}
              onClick={() => onSetPublishChoice('publish')}
            >
              Publish
            </button>
            <button
              type="button"
              className={`${styles.publishButton} ${vaPublishChoice === 'private' ? styles.publishButtonActive : styles.publishButtonInactive}`}
              onClick={() => onSetPublishChoice('private')}
            >
              Keep private
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
