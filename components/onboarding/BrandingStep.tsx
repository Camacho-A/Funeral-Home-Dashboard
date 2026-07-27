'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { useSaveBranding } from '@/hooks/useOnboarding';
import type { OnboardingSession } from '@/types/onboarding';
import styles from './OnboardingStepForm.module.css';

/** Phase 20 (Organization Onboarding & Tenant Provisioning). Step 8 —
    Branding. `logoUrl` must already be a hosted URL — this form has no
    file upload control at all ("Do not store binary logo data directly in
    Wix rows"); a future phase can add real upload-to-object-storage and
    populate this same field with the resulting URL. */
export function BrandingStep({
  onboardingSessionId,
  onSaved,
}: {
  onboardingSessionId: string;
  onSaved: (session: OnboardingSession) => void;
}) {
  const [logoUrl, setLogoUrl] = useState('');
  const [emailFromName, setEmailFromName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [secondaryColor, setSecondaryColor] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [documentFooter, setDocumentFooter] = useState('');
  const saveBranding = useSaveBranding();

  function handleSubmit() {
    saveBranding.mutate(
      { onboardingSessionId, logoUrl, emailFromName, primaryColor, secondaryColor, accentColor, documentFooter },
      { onSuccess: (result) => onSaved(result.onboardingSession) },
    );
  }

  return (
    <div>
      <div className={styles.title}>Branding</div>
      <div className={styles.description}>Optional — organization-scoped branding for documents and email.</div>

      <div className={styles.fields}>
        <div>
          <div className={styles.fieldLabel}>Logo URL</div>
          <TextField value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://cdn.example.com/logo.png" />
        </div>
        <div>
          <div className={styles.fieldLabel}>Email sender name</div>
          <TextField value={emailFromName} onChange={(e) => setEmailFromName(e.target.value)} placeholder="Smith Family Funeral Home" />
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.fieldLabel}>Primary color</div>
            <TextField value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#1a2b3c" />
          </div>
          <div>
            <div className={styles.fieldLabel}>Secondary color</div>
            <TextField value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} placeholder="#1a2b3c" />
          </div>
          <div>
            <div className={styles.fieldLabel}>Accent color</div>
            <TextField value={accentColor} onChange={(e) => setAccentColor(e.target.value)} placeholder="#1a2b3c" />
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Document footer</div>
          <TextArea value={documentFooter} onChange={(e) => setDocumentFooter(e.target.value)} placeholder="Printed on every generated document" />
        </div>
      </div>

      {saveBranding.isError && (
        <div className={styles.fieldError} role="alert">
          {saveBranding.error instanceof Error ? saveBranding.error.message : 'Failed to save.'}
        </div>
      )}

      <div className={styles.footer}>
        <Button onClick={handleSubmit} disabled={saveBranding.isPending}>
          Save &amp; Continue
        </Button>
      </div>
    </div>
  );
}
