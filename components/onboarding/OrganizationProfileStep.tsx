'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { useStartOnboarding, useSaveOrganizationProfile } from '@/hooks/useOnboarding';
import type { Organization } from '@/types/organization';
import type { OnboardingSession } from '@/types/onboarding';
import styles from './OnboardingStepForm.module.css';

type Draft = {
  legalName: string;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string;
  website: string;
  timezone: string;
  defaultCurrency: string;
};

function draftFromOrganization(organization: Organization | null): Draft {
  return {
    legalName: organization?.legalName ?? '',
    displayName: organization?.name ?? '',
    primaryEmail: organization?.primaryEmail ?? '',
    primaryPhone: organization?.primaryPhone ?? '',
    website: organization?.website ?? '',
    timezone: organization?.timezone ?? '',
    defaultCurrency: organization?.defaultCurrency ?? 'usd',
  };
}

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 1 —
 * Organization Profile. Serves two roles with one form: with no
 * `onboardingSessionId` yet, submitting calls `POST /api/onboarding/start`
 * (creating the tenant) and hands the new session id to `onStarted`; once
 * a session exists, the identical fields instead `PATCH` the existing
 * profile. Both paths are server-validated field-by-field — see
 * domain/onboarding/validation.ts.
 */
export function OrganizationProfileStep({
  onboardingSessionId,
  organization,
  onStarted,
  onSaved,
}: {
  onboardingSessionId: string | null;
  organization: Organization | null;
  onStarted: (result: { organization: Organization; onboardingSession: OnboardingSession }) => void;
  onSaved: (session: OnboardingSession) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFromOrganization(organization));
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const startOnboarding = useStartOnboarding();
  const saveProfile = useSaveOrganizationProfile();

  const mutation = onboardingSessionId ? saveProfile : startOnboarding;

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    if (!onboardingSessionId) {
      startOnboarding.mutate(
        { ...draft, idempotencyKey },
        { onSuccess: (result) => onStarted(result) },
      );
      return;
    }
    saveProfile.mutate(
      { onboardingSessionId, ...draft },
      { onSuccess: (result) => onSaved(result.onboardingSession) },
    );
  }

  return (
    <div>
      <div className={styles.title}>Organization Profile</div>
      <div className={styles.description}>
        Basic information for the new organization — used across Beacon and on family-facing documents.
      </div>

      <div className={styles.fields}>
        <div>
          <div className={styles.fieldLabel}>Legal name</div>
          <TextField value={draft.legalName} onChange={(e) => setField('legalName', e.target.value)} placeholder="Smith Family Funeral Home, LLC" />
        </div>
        <div>
          <div className={styles.fieldLabel}>Display name</div>
          <TextField value={draft.displayName} onChange={(e) => setField('displayName', e.target.value)} placeholder="Smith Family Funeral Home" />
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.fieldLabel}>Business email</div>
            <TextField value={draft.primaryEmail} onChange={(e) => setField('primaryEmail', e.target.value)} placeholder="staff@example.com" />
          </div>
          <div>
            <div className={styles.fieldLabel}>Business phone</div>
            <TextField value={draft.primaryPhone} onChange={(e) => setField('primaryPhone', e.target.value)} placeholder="(555) 000-0000" />
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Website (optional)</div>
          <TextField value={draft.website} onChange={(e) => setField('website', e.target.value)} placeholder="https://example.com" />
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.fieldLabel}>Timezone</div>
            <TextField value={draft.timezone} onChange={(e) => setField('timezone', e.target.value)} placeholder="America/New_York" />
          </div>
          <div>
            <div className={styles.fieldLabel}>Currency</div>
            <TextField value={draft.defaultCurrency} onChange={(e) => setField('defaultCurrency', e.target.value)} placeholder="usd" />
          </div>
        </div>
      </div>

      {mutation.isError && (
        <div className={styles.fieldError} role="alert">
          {mutation.error instanceof Error ? mutation.error.message : 'Failed to save.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleSubmit} disabled={mutation.isPending}>
          {onboardingSessionId ? 'Save & Continue' : 'Start Onboarding'}
        </Button>
      </div>
    </div>
  );
}
