'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { useSaveWorkflow } from '@/hooks/useOnboarding';
import type { OnboardingSession } from '@/types/onboarding';
import styles from './OnboardingStepForm.module.css';

type Mode = 'starter' | 'clone_existing' | 'minimal';

/** Phase 20 (Organization Onboarding & Tenant Provisioning). Step 4 —
    Workflow Setup. Whichever mode is chosen, the result is always a
    brand-new, organization-owned workflow — never a reference to another
    organization's template (see services/organizationProvisioningService.ts's
    provisionWorkflow). */
export function WorkflowStep({
  onboardingSessionId,
  onSaved,
}: {
  onboardingSessionId: string;
  onSaved: (session: OnboardingSession) => void;
}) {
  const [mode, setMode] = useState<Mode>('starter');
  const [sourceTemplateId, setSourceTemplateId] = useState('');
  const saveWorkflow = useSaveWorkflow();

  function handleSubmit() {
    saveWorkflow.mutate(
      { onboardingSessionId, mode, sourceTemplateId: mode === 'clone_existing' ? sourceTemplateId : undefined },
      { onSuccess: (result) => onSaved(result.onboardingSession) },
    );
  }

  return (
    <div>
      <div className={styles.title}>Workflow Setup</div>
      <div className={styles.description}>Choose how this organization&apos;s case workflow gets set up.</div>

      <div className={styles.fields}>
        <label className={styles.optionRow}>
          <input type="radio" name="workflowMode" checked={mode === 'starter'} onChange={() => setMode('starter')} />
          Use a Beacon starter workflow
        </label>
        <label className={styles.optionRow}>
          <input type="radio" name="workflowMode" checked={mode === 'clone_existing'} onChange={() => setMode('clone_existing')} />
          Clone an existing approved template
        </label>
        {mode === 'clone_existing' && (
          <TextField
            value={sourceTemplateId}
            onChange={(e) => setSourceTemplateId(e.target.value)}
            placeholder="Source template id"
            aria-label="Source template id"
          />
        )}
        <label className={styles.optionRow}>
          <input type="radio" name="workflowMode" checked={mode === 'minimal'} onChange={() => setMode('minimal')} />
          Start from a minimal workflow
        </label>
      </div>

      {saveWorkflow.isError && (
        <div className={styles.fieldError} role="alert">
          {saveWorkflow.error instanceof Error ? saveWorkflow.error.message : 'Failed to save.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleSubmit} disabled={saveWorkflow.isPending || (mode === 'clone_existing' && !sourceTemplateId.trim())}>
          Save &amp; Continue
        </Button>
      </div>
    </div>
  );
}
