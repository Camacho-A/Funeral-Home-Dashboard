/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). The onboarding
 * state model — see docs/adr/ADR-024-organization-onboarding-tenant-provisioning.md.
 * `OnboardingSession` is the one durable record of "how far has this
 * organization gotten through setup" — never inferred from scanning
 * whatever provisioning rows happen to exist, so a session can be resumed,
 * blocked, or retried without ambiguity about what step to show next.
 */
export type OnboardingStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed';

/**
 * The nine ordered onboarding steps — see domain/onboarding/steps.ts for
 * the display order/labels this type's values map to. A plain string
 * union (not a number) so a step can be inserted/reordered in the future
 * without renumbering every existing in-progress session's
 * `completedSteps` array.
 */
export type OnboardingStepKey =
  | 'organization_profile'
  | 'primary_location'
  | 'administrator_account'
  | 'workflow_setup'
  | 'intake_setup'
  | 'services_pricing'
  | 'payments'
  | 'branding'
  | 'review_launch';

export type OnboardingSession = {
  id: string;
  organizationId: string;
  status: OnboardingStatus;
  currentStep: OnboardingStepKey;
  /** Steps whose data has been saved and validated — a step can be
      revisited (backward navigation never loses data; see
      app/onboarding/'s own comment) without being removed from this list,
      since re-saving the same step is idempotent, not destructive. */
  completedSteps: OnboardingStepKey[];
  /** The user who called `POST /api/onboarding/start` — the one caller
      always authorized to resume this session even before an
      administrator membership exists for it (see
      lib/auth/requireOnboardingAccess.ts). */
  startedByUserId: string;
  startedAt: string;
  /** Set only once `completeOnboarding()` actually succeeds — null for
      every other status. */
  completedAt: string | null;
  lastSavedAt: string;
  /** Optimistic-concurrency counter, incremented on every successful step
      save — lets a future caller detect (not yet enforced as a hard
      conflict in this phase) that two tabs raced to edit the same
      session. */
  version: number;
  createdAt: string;
  updatedAt: string;
};
