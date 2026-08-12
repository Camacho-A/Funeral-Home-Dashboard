'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/useNotifications';
import { useMyIdentityProfile } from '@/hooks/useIdentityProfile';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/SelectField';
import type { NotificationCategory } from '@/domain/notifications/notificationTypeRegistry';
import type { DigestFrequency, NotificationCategoryOverride } from '@/types/notificationPreference';
import styles from './NotificationPreferencesPanel.module.css';

/**
 * Phase 28 (Communications & Notifications), extended in Phase 33 (Real
 * Notification Delivery). "Settings > Notifications" — like
 * `/settings/resources`, not identity-mode-gated: preferences are always
 * self-scoped, authorized by nothing beyond the caller's own session,
 * working identically under every `AUTH_ADAPTER`.
 *
 * Every field this component now exposes (SMS/digest frequency/quiet
 * hours/per-category overrides) was a schema-only reserve until this
 * phase — see `types/notificationPreference.ts`'s own header comment.
 */
const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  case: 'Cases',
  task: 'Tasks',
  payment: 'Payments',
  scheduling: 'Scheduling',
  document: 'Documents',
  signature: 'Signatures',
  organization: 'Organization',
  system: 'System',
  family_portal: 'Family portal',
  financial: 'Financial',
};

const CATEGORY_ORDER: NotificationCategory[] = ['case', 'task', 'scheduling', 'document', 'signature', 'payment', 'financial', 'family_portal', 'organization', 'system'];

const DEFAULT_CATEGORY_OVERRIDE: NotificationCategoryOverride = { emailEnabled: true, inAppEnabled: true, smsEnabled: false };

export function NotificationPreferencesPanel() {
  const { organizationId } = useOrganization();
  const preferencesQuery = useNotificationPreferences(organizationId);
  const updatePreferences = useUpdateNotificationPreferences(organizationId);
  const profileQuery = useMyIdentityProfile(organizationId);

  if (preferencesQuery.isPending) return <p className={styles.loading}>Loading preferences…</p>;
  if (preferencesQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load preferences. Please try again.</p>;

  const preferences = preferencesQuery.data!;
  const hasPhone = Boolean(profileQuery.data?.phone);

  function toggleCategoryOverride(category: NotificationCategory, enabled: boolean) {
    const next = { ...preferences.categoryOverrides };
    if (enabled) {
      next[category] = next[category] ?? DEFAULT_CATEGORY_OVERRIDE;
    } else {
      delete next[category];
    }
    updatePreferences.mutate({ categoryOverrides: next });
  }

  function patchCategoryOverride(category: NotificationCategory, patch: Partial<NotificationCategoryOverride>) {
    const current = preferences.categoryOverrides[category] ?? DEFAULT_CATEGORY_OVERRIDE;
    updatePreferences.mutate({ categoryOverrides: { ...preferences.categoryOverrides, [category]: { ...current, ...patch } } });
  }

  return (
    <div className={styles.sections}>
      <Card className={styles.card}>
        <h3 className={styles.sectionTitle}>Global channels</h3>
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
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={preferences.smsEnabled}
            disabled={updatePreferences.isPending}
            onChange={(e) => updatePreferences.mutate({ smsEnabled: e.target.checked })}
          />
          SMS notifications
        </label>
        {preferences.smsEnabled && !hasPhone && (
          <p className={styles.hint}>Add a phone number in Security settings to actually receive SMS notifications.</p>
        )}
      </Card>

      <Card className={styles.card}>
        <h3 className={styles.sectionTitle}>Email timing</h3>
        <label className={styles.fieldLabel}>
          Digest frequency
          <SelectField
            value={preferences.digestFrequency}
            disabled={updatePreferences.isPending}
            onChange={(e) => updatePreferences.mutate({ digestFrequency: e.target.value as DigestFrequency })}
          >
            <option value="instant">Instant — send each email right away</option>
            <option value="daily">Daily digest — one combined email per day</option>
            <option value="weekly">Weekly digest — one combined email per week</option>
          </SelectField>
        </label>
        <p className={styles.hint}>In-app and SMS notifications are never batched — this only affects email.</p>
        <div className={styles.quietHoursRow}>
          <label className={styles.fieldLabel}>
            Quiet hours start
            <input
              type="time"
              className={styles.timeInput}
              value={preferences.quietHoursStart ?? ''}
              disabled={updatePreferences.isPending}
              onChange={(e) => updatePreferences.mutate({ quietHoursStart: e.target.value || null })}
            />
          </label>
          <label className={styles.fieldLabel}>
            Quiet hours end
            <input
              type="time"
              className={styles.timeInput}
              value={preferences.quietHoursEnd ?? ''}
              disabled={updatePreferences.isPending}
              onChange={(e) => updatePreferences.mutate({ quietHoursEnd: e.target.value || null })}
            />
          </label>
        </div>
        <p className={styles.hint}>An email that would otherwise send during quiet hours is held and delivered right after they end.</p>
      </Card>

      <Card className={styles.card}>
        <h3 className={styles.sectionTitle}>Per-category overrides</h3>
        <p className={styles.hint}>Override the global channels above for one notification category. A category with no override uses the global settings.</p>
        <table className={styles.overrideTable}>
          <thead>
            <tr>
              <th>Category</th>
              <th>Override?</th>
              <th>In-app</th>
              <th>Email</th>
              <th>SMS</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((category) => {
              const override = preferences.categoryOverrides[category];
              const hasOverride = override !== undefined;
              const effective = override ?? DEFAULT_CATEGORY_OVERRIDE;
              return (
                <tr key={category}>
                  <td>{CATEGORY_LABELS[category]}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={hasOverride}
                      disabled={updatePreferences.isPending}
                      onChange={(e) => toggleCategoryOverride(category, e.target.checked)}
                      aria-label={`Override ${CATEGORY_LABELS[category]}`}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={effective.inAppEnabled}
                      disabled={!hasOverride || updatePreferences.isPending}
                      onChange={(e) => patchCategoryOverride(category, { inAppEnabled: e.target.checked })}
                      aria-label={`${CATEGORY_LABELS[category]} in-app`}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={effective.emailEnabled}
                      disabled={!hasOverride || updatePreferences.isPending}
                      onChange={(e) => patchCategoryOverride(category, { emailEnabled: e.target.checked })}
                      aria-label={`${CATEGORY_LABELS[category]} email`}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={effective.smsEnabled}
                      disabled={!hasOverride || updatePreferences.isPending}
                      onChange={(e) => patchCategoryOverride(category, { smsEnabled: e.target.checked })}
                      aria-label={`${CATEGORY_LABELS[category]} sms`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
