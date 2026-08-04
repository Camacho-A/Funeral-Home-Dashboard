'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/useNotifications';
import { Card } from '@/components/ui/Card';
import styles from './NotificationPreferencesPanel.module.css';

/**
 * Phase 28 (Communications & Notifications). "Settings > Notifications" —
 * like `/settings/resources`, not identity-mode-gated: preferences are
 * always self-scoped, authorized by nothing beyond the caller's own
 * session, working identically under every `AUTH_ADAPTER`. Only the
 * global Email/In-App toggles are exposed — digest frequency, quiet
 * hours, and per-category overrides are schema-only reserves this phase
 * (see `types/notificationPreference.ts`).
 */
export function NotificationPreferencesPanel() {
  const { organizationId } = useOrganization();
  const preferencesQuery = useNotificationPreferences(organizationId);
  const updatePreferences = useUpdateNotificationPreferences(organizationId);

  if (preferencesQuery.isPending) return <p className={styles.loading}>Loading preferences…</p>;
  if (preferencesQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load preferences. Please try again.</p>;

  const preferences = preferencesQuery.data!;

  return (
    <Card className={styles.card}>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={preferences.inAppEnabled}
          disabled={updatePreferences.isPending}
          onChange={(e) => updatePreferences.mutate({ inAppEnabled: e.target.checked })}
        />
        In-app notifications
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={preferences.emailEnabled}
          disabled={updatePreferences.isPending}
          onChange={(e) => updatePreferences.mutate({ emailEnabled: e.target.checked })}
        />
        Email notifications
      </label>
    </Card>
  );
}
