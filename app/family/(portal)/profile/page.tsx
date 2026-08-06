'use client';

import { useFamilyNotificationPreferences, useUpdateFamilyNotificationPreferences } from '@/hooks/useFamilyNotifications';
import { Card } from '@/components/ui/Card';
import styles from './page.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). Notification
 * preferences — the one piece of account-level settings this phase
 * exposes to the family surface (mirrors the staff
 * `NotificationPreferencesPanel.tsx`'s own global emailEnabled/inAppEnabled
 * toggle exactly; per-category overrides remain a schema-only reserve on
 * both sides). Signing out lives in the shell's own top bar, not
 * duplicated here.
 */
export default function FamilyProfilePage() {
  const preferencesQuery = useFamilyNotificationPreferences();
  const updatePreferences = useUpdateFamilyNotificationPreferences();

  if (preferencesQuery.isPending) return <p className={styles.loading}>Loading preferences…</p>;
  if (preferencesQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load preferences. Please try again.</p>;

  const preferences = preferencesQuery.data;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Profile</h1>

      <Card className={styles.card}>
        <h2 className={styles.sectionTitle}>Notification Preferences</h2>
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
    </div>
  );
}
