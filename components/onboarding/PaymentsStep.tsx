'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { useSavePayments } from '@/hooks/useOnboarding';
import type { OnboardingSession } from '@/types/onboarding';
import styles from './OnboardingStepForm.module.css';

type Choice = 'clover' | 'not_configured' | 'configure_later';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 7 —
 * Payments. Never collects a real credential value — only environment
 * variable *reference names* the server will later resolve
 * (lib/clover/cloverConfig.ts); the integration this creates always
 * starts disabled ("Clover not configured") until credentials are set and
 * verified server-side, entirely outside this form.
 */
export function PaymentsStep({
  onboardingSessionId,
  onSaved,
}: {
  onboardingSessionId: string;
  onSaved: (session: OnboardingSession) => void;
}) {
  const [choice, setChoice] = useState<Choice>('configure_later');
  const [merchantIdReference, setMerchantIdReference] = useState('');
  const [credentialReference, setCredentialReference] = useState('');
  const [webhookSecretReference, setWebhookSecretReference] = useState('');
  const savePayments = useSavePayments();

  function handleSubmit() {
    savePayments.mutate(
      { onboardingSessionId, choice, merchantIdReference, credentialReference, webhookSecretReference },
      { onSuccess: (result) => onSaved(result.onboardingSession) },
    );
  }

  return (
    <div>
      <div className={styles.title}>Payments</div>
      <div className={styles.description}>
        Payment integration readiness. This never needs to be enabled before launch.
      </div>

      <div className={styles.fields}>
        <label className={styles.optionRow}>
          <input type="radio" name="paymentChoice" checked={choice === 'clover'} onChange={() => setChoice('clover')} />
          Clover
        </label>
        {choice === 'clover' && (
          <>
            <TextField value={merchantIdReference} onChange={(e) => setMerchantIdReference(e.target.value)} placeholder="Merchant id env var reference name" aria-label="Merchant id reference" />
            <TextField value={credentialReference} onChange={(e) => setCredentialReference(e.target.value)} placeholder="Private key env var reference name" aria-label="Credential reference" />
            <TextField value={webhookSecretReference} onChange={(e) => setWebhookSecretReference(e.target.value)} placeholder="Webhook secret env var reference name" aria-label="Webhook secret reference" />
          </>
        )}
        <label className={styles.optionRow}>
          <input type="radio" name="paymentChoice" checked={choice === 'not_configured'} onChange={() => setChoice('not_configured')} />
          Not configured
        </label>
        <label className={styles.optionRow}>
          <input type="radio" name="paymentChoice" checked={choice === 'configure_later'} onChange={() => setChoice('configure_later')} />
          Configure later
        </label>
      </div>

      {savePayments.data && (
        <div className={styles.summaryRow}>
          <span>Status</span>
          <span>{savePayments.data.readiness}</span>
        </div>
      )}

      {savePayments.isError && (
        <div className={styles.fieldError} role="alert">
          {savePayments.error instanceof Error ? savePayments.error.message : 'Failed to save.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleSubmit} disabled={savePayments.isPending}>
          Save &amp; Continue
        </Button>
      </div>
    </div>
  );
}
