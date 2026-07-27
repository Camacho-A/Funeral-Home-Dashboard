import type { OnboardingStepKey } from '../../types/onboarding';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). The nine
 * ordered onboarding steps — the one place their order/labels are defined,
 * read by both the API routes (to compute "next step") and the
 * `/onboarding` UI (to render the step list).
 */
export type OnboardingStepDefinition = {
  key: OnboardingStepKey;
  order: number;
  label: string;
};

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  { key: 'organization_profile', order: 1, label: 'Organization Profile' },
  { key: 'primary_location', order: 2, label: 'Primary Location' },
  { key: 'administrator_account', order: 3, label: 'Administrator Account' },
  { key: 'workflow_setup', order: 4, label: 'Workflow Setup' },
  { key: 'intake_setup', order: 5, label: 'Intake Setup' },
  { key: 'services_pricing', order: 6, label: 'Services & Pricing' },
  { key: 'payments', order: 7, label: 'Payments' },
  { key: 'branding', order: 8, label: 'Branding' },
  { key: 'review_launch', order: 9, label: 'Review & Launch' },
];

const STEP_ORDER: OnboardingStepKey[] = ONBOARDING_STEPS.map((s) => s.key);

export function stepOrder(step: OnboardingStepKey): number {
  return STEP_ORDER.indexOf(step);
}

export function nextStep(step: OnboardingStepKey): OnboardingStepKey | null {
  const index = stepOrder(step);
  return index === -1 || index === STEP_ORDER.length - 1 ? null : STEP_ORDER[index + 1];
}

export function isFinalStep(step: OnboardingStepKey): boolean {
  return step === 'review_launch';
}

/** Every step this organization has not yet completed, in order — what
    the launch checklist and "remaining steps" UI both read. */
export function remainingSteps(completedSteps: OnboardingStepKey[]): OnboardingStepKey[] {
  const completed = new Set(completedSteps);
  return STEP_ORDER.filter((key) => !completed.has(key));
}
