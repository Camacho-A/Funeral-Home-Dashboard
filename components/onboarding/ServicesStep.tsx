'use client';

import { Button } from '@/components/ui/Button';
import { useSaveServices } from '@/hooks/useOnboarding';
import { formatCentsAsCurrency } from '@/utils/format';
import type { OnboardingSession } from '@/types/onboarding';
import styles from './OnboardingStepForm.module.css';

/** Phase 20 (Organization Onboarding & Tenant Provisioning). Step 6 —
    Services & Pricing. Seeds a fresh, organization-owned service catalog
    — never a reference to Manor's Cremation's (or any other
    organization's) rows. */
export function ServicesStep({
  onboardingSessionId,
  onSaved,
}: {
  onboardingSessionId: string;
  onSaved: (session: OnboardingSession) => void;
}) {
  const saveServices = useSaveServices();

  function handleSubmit() {
    saveServices.mutate(onboardingSessionId, { onSuccess: (result) => onSaved(result.onboardingSession) });
  }

  return (
    <div>
      <div className={styles.title}>Services &amp; Pricing</div>
      <div className={styles.description}>
        Seeds this organization&apos;s own starter service catalog — independent from every other organization&apos;s pricing.
      </div>

      {saveServices.data && (
        <div className={styles.summaryList}>
          {saveServices.data.catalog.map((item) => (
            <div key={item.id} className={styles.summaryRow}>
              <span>{item.displayName}</span>
              <span>{formatCentsAsCurrency(item.defaultPrice, 'usd')}</span>
            </div>
          ))}
        </div>
      )}

      {saveServices.isError && (
        <div className={styles.fieldError} role="alert">
          {saveServices.error instanceof Error ? saveServices.error.message : 'Failed to save.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleSubmit} disabled={saveServices.isPending}>
          {saveServices.data ? 'Continue' : 'Seed Service Catalog'}
        </Button>
      </div>
    </div>
  );
}
