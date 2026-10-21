import { SlaSettingsPanel } from '@/components/settings/SlaSettingsPanel';

/**
 * SLA tracking (2026-10). "Settings > SLA Targets" — administrators only
 * (the API checks `organization.manage`), and only for an organization
 * with SLA tracking (the settings nav hides it otherwise).
 */
export default function SlaSettingsPage() {
  return (
    <div>
      <h1>SLA Targets</h1>
      <SlaSettingsPanel />
    </div>
  );
}
