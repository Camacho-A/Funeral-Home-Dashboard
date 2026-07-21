import type { Case } from '../../types/case';
import type { VaStepViewModel } from '../../types/caseViewModel';

/** Ported verbatim from design/support.js's VA_STEPS. */
export const VA_STEPS = [
  'Called the VA',
  'VA called back with a date',
  'Called Military Honors',
] as const;

/** The veteran flag itself can only be toggled through First Call & Payment
    (raw stage <= 1) — matches design/support.js's `veteranLocked = raw.stage > 1`. */
export function isVeteranFlagLocked(rawStage: number): boolean {
  return rawStage > 1;
}

export function buildVaSteps(case_: Case): VaStepViewModel[] {
  return VA_STEPS.map((label, index) => ({
    index,
    label,
    done: Boolean(case_.vaStepsState[index]),
    locked: index > 0 && !case_.vaStepsState[index - 1],
  }));
}

export function isVaCallbackDone(case_: Case): boolean {
  // Step index 1 = "VA called back with a date" — once done, the case must
  // decide to publish the service or keep it private (see PublishChoiceButtons,
  // docs/UI_COMPONENTS.md).
  return Boolean(case_.vaStepsState[1]);
}

export function isVaComplete(case_: Case): boolean {
  return (
    VA_STEPS.every((_, index) => Boolean(case_.vaStepsState[index])) &&
    case_.vaPublishChoice != null
  );
}

/**
 * A veteran case whose VA process isn't fully complete needs attention on
 * the Dashboard, same standing as a stalled case — see
 * domain/cases/viewModel.ts for how this combines with the stalled-reason
 * rule into a single `attentionReason`.
 */
export function needsVeteranAttention(case_: Case): boolean {
  return case_.isVeteran && !isVaComplete(case_);
}
