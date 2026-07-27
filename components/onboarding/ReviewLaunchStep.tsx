'use client';

import { Button } from '@/components/ui/Button';
import { useCompleteOnboarding } from '@/hooks/useOnboarding';
import type { LaunchChecklistItem } from '@/domain/onboarding/launchReadiness';
import type { Organization } from '@/types/organization';
import styles from './OnboardingStepForm.module.css';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 9 —
 * Review & Launch. The checklist and `ready` flag are always computed
 * fresh server-side from real provisioning state (never from the client's
 * own idea of what's been completed) — see
 * services/organizationProvisioningService.ts's `validateLaunchReadiness`.
 * "Only the server may mark onboarding completed": clicking Launch simply
 * calls `POST /api/onboarding/complete`, which independently re-validates
 * before activating anything.
 */
export function ReviewLaunchStep({
  onboardingSessionId,
  organization,
  checklist,
  ready,
  onLaunched,
}: {
  onboardingSessionId: string;
  organization: Organization | null;
  checklist: LaunchChecklistItem[];
  ready: boolean;
  onLaunched: () => void;
}) {
  const complete = useCompleteOnboarding();

  function handleLaunch() {
    complete.mutate(onboardingSessionId, { onSuccess: () => onLaunched() });
  }

  if (organization?.status === 'active') {
    return (
      <div>
        <div className={styles.title}>Review &amp; Launch</div>
        <p>This organization is live.</p>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.title}>Review &amp; Launch</div>
      <div className={styles.description}>Confirm everything below before activating this organization.</div>

      <div className={styles.summaryList}>
        {checklist.map((item) => (
          <div key={item.key} className={styles.summaryRow}>
            <span>{item.label}</span>
            <span className={item.satisfied ? styles.checklistDone : styles.checklistPending}>
              {item.satisfied ? 'Complete' : 'Incomplete'}
            </span>
          </div>
        ))}
      </div>

      {complete.isError && (
        <div className={styles.fieldError} role="alert">
          {complete.error instanceof Error ? complete.error.message : 'Launch requirements are not yet met.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleLaunch} disabled={!ready || complete.isPending}>
          {complete.isPending ? 'Launching…' : 'Launch'}
        </Button>
      </div>
    </div>
  );
}
