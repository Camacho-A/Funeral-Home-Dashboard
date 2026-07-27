import { ONBOARDING_STEPS } from '@/domain/onboarding/steps';
import type { OnboardingStepKey } from '@/types/onboarding';
import styles from './OnboardingStepList.module.css';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Displays
 * current/completed/remaining steps — a completed step stays clickable
 * (revisiting it never loses its saved data; the form re-loads whatever
 * was already saved), while a step that hasn't been reached yet is
 * disabled, since its own form may depend on an earlier step's output
 * (e.g. Intake Setup reads back Workflow Setup's result).
 */
export function OnboardingStepList({
  currentStep,
  completedSteps,
  onSelectStep,
}: {
  currentStep: OnboardingStepKey;
  completedSteps: OnboardingStepKey[];
  onSelectStep: (step: OnboardingStepKey) => void;
}) {
  const completed = new Set(completedSteps);
  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <nav className={styles.list} aria-label="Onboarding steps">
      {ONBOARDING_STEPS.map((step, index) => {
        const isDone = completed.has(step.key);
        const isCurrent = step.key === currentStep;
        const isReachable = isDone || isCurrent || index <= currentIndex;

        return (
          <button
            key={step.key}
            type="button"
            disabled={!isReachable}
            onClick={() => onSelectStep(step.key)}
            className={[styles.item, isCurrent ? styles.current : '', isDone ? styles.completed : ''].filter(Boolean).join(' ')}
          >
            <span className={[styles.marker, isDone ? styles.markerDone : '', isCurrent && !isDone ? styles.markerCurrent : ''].filter(Boolean).join(' ')}>
              {isDone ? '✓' : step.order}
            </span>
            {step.label}
          </button>
        );
      })}
    </nav>
  );
}
