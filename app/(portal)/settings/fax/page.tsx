'use client';

import { FaxSettingsPanel } from '@/components/settings/FaxSettingsPanel';
import { SettingsAreaUnavailable } from '@/components/settings/SettingsAreaUnavailable';
import { useOrganization } from '@/hooks/useOrganization';
import { deathCertificateFaxSettings } from '@/domain/faxBundles/faxSettings';

/**
 * Fax Settings (2026-11). "Settings > Fax Settings" — administrators only
 * (the API checks `organization.manage`), and only for an organization that
 * faxes (the settings nav hides it otherwise). Opened by its address by an
 * organization without faxing, it says so instead of loading forever; the
 * fax APIs refuse that organization on their own.
 */
export default function FaxSettingsPage() {
  const { organizationId } = useOrganization();
  if (deathCertificateFaxSettings(organizationId) === null) {
    return <SettingsAreaUnavailable title="Fax Settings" message="Faxing is not set up for this organization." />;
  }
  return (
    <div>
      <h1>Fax Settings</h1>
      <FaxSettingsPanel />
    </div>
  );
}
