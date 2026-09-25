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

/**
 * VA responsibility correction (2026-09): `isVeteran` ("did the decedent
 * serve") and `vaNotificationResponsibility` ("who is handling notifying
 * the VA") are independent facts — see types/case.ts's own comment on
 * why conflating them was a real bug. When FAMILY has taken
 * responsibility, Manors' own internal VA_STEPS checklist simply does not
 * apply — staff are never required to complete it, and this returns
 * `true` immediately, without inspecting `vaStepsState`/`vaPublishChoice`
 * at all (those remain whatever they were, untouched — never
 * back-filled to look like Manors completed something it didn't).
 *
 * When responsibility is MANORS or still undecided (`null`), behavior is
 * unchanged from before this correction: complete only once every
 * VA_STEPS item is done and a publish choice has been made. Undecided is
 * deliberately treated the same as "not complete" — "fail safely," never
 * assumed equivalent to either MANORS or FAMILY (see
 * `types/case.ts#VaNotificationResponsibility`'s own comment).
 */
export function isVaComplete(case_: Case): boolean {
  if (case_.vaNotificationResponsibility === 'family') return true;
  return (
    VA_STEPS.every((_, index) => Boolean(case_.vaStepsState[index])) &&
    case_.vaPublishChoice != null
  );
}

/**
 * A veteran case whose VA process isn't fully complete needs attention on
 * the Dashboard, same standing as a stalled case — see
 * domain/cases/viewModel.ts for how this combines with the stalled-reason
 * rule into a single `attentionReason`. Once `isVeteran` is false, this is
 * unconditionally false regardless of any stale `vaNotificationResponsibility`
 * value left over from when it was true — "Do not silently misrepresent
 * historical audit state" (never cleared) never means it's read again
 * while the veteran flag is off.
 */
export function needsVeteranAttention(case_: Case): boolean {
  return case_.isVeteran && !isVaComplete(case_);
}
