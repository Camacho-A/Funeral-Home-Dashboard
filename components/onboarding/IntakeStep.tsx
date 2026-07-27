'use client';

import { Button } from '@/components/ui/Button';
import { useSaveIntake } from '@/hooks/useOnboarding';
import type { OnboardingSession } from '@/types/onboarding';
import type { IntakeTemplate } from '@/types/workflowTemplate';
import styles from './OnboardingStepForm.module.css';

/** Phase 20 (Organization Onboarding & Tenant Provisioning). Step 5 —
    Intake Setup. Review-only: the intake configuration was already seeded
    by Step 4's chosen workflow (intake lives inside a
    WorkflowTemplateVersion, not a separate collection) — this step lets
    staff confirm the enabled fields before moving on. Never shows a
    retired payment-card field type; the server already filters them
    defensively (see provisionIntakeConfiguration's own comment). */
export function IntakeStep({
  onboardingSessionId,
  intake,
  onSaved,
}: {
  onboardingSessionId: string;
  intake: IntakeTemplate | null;
  onSaved: (session: OnboardingSession) => void;
}) {
  const saveIntake = useSaveIntake();

  function handleSubmit() {
    saveIntake.mutate(onboardingSessionId, { onSuccess: (result) => onSaved(result.onboardingSession) });
  }

  return (
    <div>
      <div className={styles.title}>Intake Setup</div>
      <div className={styles.description}>Review the intake fields seeded from this organization&apos;s workflow.</div>

      {!intake || intake.sections.length === 0 ? (
        <p>Complete Workflow Setup first.</p>
      ) : (
        <div className={styles.summaryList}>
          {intake.sections.map((section) => (
            <div key={section.key}>
              <div className={styles.fieldLabel}>{section.label}</div>
              {section.fields.map((field) => (
                <div key={field.key} className={styles.summaryRow}>
                  <span>{field.label}</span>
                  <span>{field.required ? 'Required' : 'Optional'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {saveIntake.isError && (
        <div className={styles.fieldError} role="alert">
          {saveIntake.error instanceof Error ? saveIntake.error.message : 'Failed to save.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleSubmit} disabled={saveIntake.isPending || !intake}>
          Confirm &amp; Continue
        </Button>
      </div>
    </div>
  );
}
