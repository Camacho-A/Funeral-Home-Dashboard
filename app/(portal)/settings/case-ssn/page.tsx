'use client';

import { CaseSsnBackfillPanel } from '@/components/settings/CaseSsnBackfillPanel';

/**
 * Case SSN (2026-10). "Settings > Case SSN" — the one-time fill for
 * existing cases. Administrators only (the API checks `organization.manage`),
 * and only for an organization that keeps case SSNs (the settings nav hides
 * it otherwise).
 */
export default function CaseSsnSettingsPage() {
  return (
    <div>
      <h1>Case SSN</h1>
      <CaseSsnBackfillPanel />
    </div>
  );
}
