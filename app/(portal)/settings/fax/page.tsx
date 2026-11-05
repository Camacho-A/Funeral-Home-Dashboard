'use client';

import { FaxSettingsPanel } from '@/components/settings/FaxSettingsPanel';

/**
 * Fax Settings (2026-11). "Settings > Fax Settings" — administrators only
 * (the API checks `organization.manage`), and only for an organization that
 * faxes (the settings nav hides it otherwise).
 */
export default function FaxSettingsPage() {
  return (
    <div>
      <h1>Fax Settings</h1>
      <FaxSettingsPanel />
    </div>
  );
}
