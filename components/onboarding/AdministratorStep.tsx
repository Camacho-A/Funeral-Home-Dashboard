'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { useSaveAdministrator } from '@/hooks/useOnboarding';
import type { OnboardingSession } from '@/types/onboarding';
import styles from './OnboardingStepForm.module.css';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 3 —
 * Administrator Account. Identifies who the organization's initial
 * administrator is — always assigned the fixed `'administrator'` role
 * server-side; there is no role picker here at all, since the client has
 * no way to request any other role in the first place ("Do not allow the
 * client to assign arbitrary platform-level permissions").
 */
export function AdministratorStep({
  onboardingSessionId,
  onSaved,
}: {
  onboardingSessionId: string;
  onSaved: (session: OnboardingSession) => void;
}) {
  const [administratorUserId, setAdministratorUserId] = useState('');
  const saveAdministrator = useSaveAdministrator();

  function handleSubmit() {
    saveAdministrator.mutate(
      { onboardingSessionId, administratorUserId },
      { onSuccess: (result) => onSaved(result.onboardingSession) },
    );
  }

  return (
    <div>
      <div className={styles.title}>Administrator Account</div>
      <div className={styles.description}>
        The person who will manage this organization in Beacon. They&apos;ll be granted the organization-scoped Administrator
        role — never a platform-level permission.
      </div>

      <div className={styles.fields}>
        <div>
          <div className={styles.fieldLabel}>Administrator user id</div>
          <TextField
            value={administratorUserId}
            onChange={(e) => setAdministratorUserId(e.target.value)}
            placeholder="Existing Beacon or Wix member id"
          />
        </div>
      </div>

      {saveAdministrator.isError && (
        <div className={styles.fieldError} role="alert">
          {saveAdministrator.error instanceof Error ? saveAdministrator.error.message : 'Failed to save.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleSubmit} disabled={saveAdministrator.isPending || !administratorUserId.trim()}>
          Save &amp; Continue
        </Button>
      </div>
    </div>
  );
}
