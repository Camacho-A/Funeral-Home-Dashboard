import { NotificationPreferencesPanel } from '@/components/settings/NotificationPreferencesPanel';

/**
 * Phase 28 (Communications & Notifications). "Settings > Notifications" —
 * unlike `/settings/team`/`/settings/roles`/`/settings/audit`/
 * `/settings/document-templates`, this page is not identity-mode-gated:
 * notification preferences are always self-scoped, authorized by nothing
 * beyond the caller's own session, working identically under every
 * `AUTH_ADAPTER` — matching `/settings/resources`'s own precedent.
 */
export default function NotificationsSettingsPage() {
  return (
    <div>
      <h1>Notifications</h1>
      <NotificationPreferencesPanel />
    </div>
  );
}
