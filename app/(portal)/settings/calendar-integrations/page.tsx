import { CalendarIntegrationsPanel } from '@/components/settings/CalendarIntegrationsPanel';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). "Settings > Calendar Integrations" — not identity-mode-
 * gated: calendar connections and personal feed links are always
 * self-scoped, matching `/settings/notifications`/`/settings/resources`'s
 * own precedent.
 */
export default function CalendarIntegrationsSettingsPage() {
  return (
    <div>
      <h1>Calendar Integrations</h1>
      <CalendarIntegrationsPanel />
    </div>
  );
}
