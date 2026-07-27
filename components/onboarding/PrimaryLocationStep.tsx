'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { useSavePrimaryLocation } from '@/hooks/useOnboarding';
import type { OnboardingSession } from '@/types/onboarding';
import styles from './OnboardingStepForm.module.css';

/** Phase 20 (Organization Onboarding & Tenant Provisioning). Step 2 —
    Primary Location. Idempotent server-side: revisiting this step after
    it's already saved simply re-confirms the existing primary location
    rather than creating a second one. */
export function PrimaryLocationStep({
  onboardingSessionId,
  onSaved,
}: {
  onboardingSessionId: string;
  onSaved: (session: OnboardingSession) => void;
}) {
  const [name, setName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('US');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isPrimaryDesignation, setIsPrimaryDesignation] = useState(true);
  const saveLocation = useSavePrimaryLocation();

  function handleSubmit() {
    saveLocation.mutate(
      { onboardingSessionId, name, addressLine1, city, state, postalCode, country, phone, email: email || undefined },
      { onSuccess: (result) => onSaved(result.onboardingSession) },
    );
  }

  return (
    <div>
      <div className={styles.title}>Primary Location</div>
      <div className={styles.description}>The organization&apos;s main office or funeral home location.</div>

      <div className={styles.fields}>
        <div>
          <div className={styles.fieldLabel}>Location name</div>
          <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Office" />
        </div>
        <div>
          <div className={styles.fieldLabel}>Address</div>
          <TextField value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="123 Main St" />
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.fieldLabel}>City</div>
            <TextField value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <div className={styles.fieldLabel}>State</div>
            <TextField value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div>
            <div className={styles.fieldLabel}>Postal code</div>
            <TextField value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </div>
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.fieldLabel}>Country</div>
            <TextField value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div>
            <div className={styles.fieldLabel}>Phone</div>
            <TextField value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0000" />
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Email (optional)</div>
          <TextField value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <label className={styles.optionRow}>
          <Checkbox checked={isPrimaryDesignation} onChange={() => setIsPrimaryDesignation((v) => !v)} aria-label="Designate as primary location" />
          Designate as this organization&apos;s primary location
        </label>
      </div>

      {saveLocation.isError && (
        <div className={styles.fieldError} role="alert">
          {saveLocation.error instanceof Error ? saveLocation.error.message : 'Failed to save.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleSubmit} disabled={saveLocation.isPending || !isPrimaryDesignation}>
          Save &amp; Continue
        </Button>
      </div>
    </div>
  );
}
