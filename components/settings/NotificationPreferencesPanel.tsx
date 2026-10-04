'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/useNotifications';
import { useMyIdentityProfile } from '@/hooks/useIdentityProfile';
import { SelectField } from '@/components/ui/SelectField';
import type { NotificationCategory } from '@/domain/notifications/notificationTypeRegistry';
import type { DigestFrequency, NotificationCategoryOverride } from '@/types/notificationPreference';

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
  commerce: 'Commerce',
};

const CATEGORY_ORDER: NotificationCategory[] = ['case', 'task', 'scheduling', 'document', 'signature', 'payment', 'financial', 'family_portal', 'organization', 'system'];

const DEFAULT_CATEGORY_OVERRIDE: NotificationCategoryOverride = { emailEnabled: true, inAppEnabled: true, smsEnabled: false };

export function NotificationPreferencesPanel() {
  const { organizationId } = useOrganization();
  const preferencesQuery = useNotificationPreferences(organizationId);
  const updatePreferences = useUpdateNotificationPreferences(organizationId);
  const profileQuery = useMyIdentityProfile(organizationId);

  if (preferencesQuery.isPending) {
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sr-only">Loading preferences…</span>
      </div>
    );
  }
  if (preferencesQuery.isError) return <div className="sx-error-state" role="alert">Couldn&rsquo;t load preferences. Please try again.</div>;

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
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Notifications</h2>
        <p className="sx-settings-desc">Choose how and when SOLIS notifies you. These preferences apply only to your account.</p>
      </div>

      <section className="sx-settings-section">
        <div className="sx-settings-section-head">
          <div>
            <h3 className="sx-settings-section-title">Global channels</h3>
            <p className="sx-settings-section-desc">Where your notifications are delivered. You can override these per category below.</p>
          </div>
        </div>
        <div className="sx-channel-list">
          <label className="sx-channel">
            <input
              type="checkbox"
              aria-label="In-app notifications"
              checked={preferences.inAppEnabled}
              disabled={updatePreferences.isPending}
              onChange={(e) => updatePreferences.mutate({ inAppEnabled: e.target.checked })}
            />
            <span>
              <span className="sx-channel-name">In-app notifications</span>
              <span className="sx-channel-desc">Shown in the bell menu at the top of SOLIS.</span>
            </span>
          </label>
          <label className="sx-channel">
            <input
              type="checkbox"
              aria-label="Email notifications"
              checked={preferences.emailEnabled}
              disabled={updatePreferences.isPending}
              onChange={(e) => updatePreferences.mutate({ emailEnabled: e.target.checked })}
            />
            <span>
              <span className="sx-channel-name">Email notifications</span>
              <span className="sx-channel-desc">Sent to your account email. Timing is set under Email timing.</span>
            </span>
          </label>
          <label className="sx-channel">
            <input
              type="checkbox"
              aria-label="SMS notifications"
              checked={preferences.smsEnabled}
              disabled={updatePreferences.isPending}
              onChange={(e) => updatePreferences.mutate({ smsEnabled: e.target.checked })}
            />
            <span>
              <span className="sx-channel-name">SMS notifications</span>
              <span className="sx-channel-desc">Text messages to the phone number on your profile.</span>
            </span>
          </label>
        </div>
        {preferences.smsEnabled && !hasPhone && (
          <p className="sx-form-banner sx-form-banner-info" style={{ marginTop: 12 }}>
            Add a phone number in Security settings to actually receive SMS notifications.
          </p>
        )}
      </section>

      <section className="sx-settings-section">
        <div className="sx-settings-section-head">
          <div>
            <h3 className="sx-settings-section-title">Email timing</h3>
            <p className="sx-settings-section-desc">Batch emails and pause delivery overnight.</p>
          </div>
        </div>
        <div className="sx-form-grid">
          <label className="sx-field">
            <span className="sx-label">Digest frequency</span>
            <SelectField
              className="sx-select"
              value={preferences.digestFrequency}
              disabled={updatePreferences.isPending}
              onChange={(e) => updatePreferences.mutate({ digestFrequency: e.target.value as DigestFrequency })}
            >
              <option value="instant">Instant — send each email right away</option>
              <option value="daily">Daily digest — one combined email per day</option>
              <option value="weekly">Weekly digest — one combined email per week</option>
            </SelectField>
          </label>
          <p className="sx-help" style={{ marginTop: 6, gridColumn: '1 / -1' }}>In-app and SMS notifications are never batched — this only affects email.</p>
        </div>
        <div className="sx-form-grid" style={{ marginTop: 10 }}>
          <label className="sx-field">
            <span className="sx-label">Quiet hours start</span>
            <input
              type="time"
              className="sx-input"
              value={preferences.quietHoursStart ?? ''}
              disabled={updatePreferences.isPending}
              onChange={(e) => updatePreferences.mutate({ quietHoursStart: e.target.value || null })}
            />
          </label>
          <label className="sx-field">
            <span className="sx-label">Quiet hours end</span>
            <input
              type="time"
              className="sx-input"
              value={preferences.quietHoursEnd ?? ''}
              disabled={updatePreferences.isPending}
              onChange={(e) => updatePreferences.mutate({ quietHoursEnd: e.target.value || null })}
            />
          </label>
          <p className="sx-help" style={{ marginTop: 6, gridColumn: '1 / -1' }}>An email that would otherwise send during quiet hours is held and delivered right after they end.</p>
        </div>
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Per-category overrides</h3>
        <p className="sx-help">Override the global channels above for one notification category. A category with no override uses the global settings.</p>
        <div className="sx-table-wrap">
          <table className="sx-table">
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: 'center', width: 90 }}>Override?</th>
                <th style={{ textAlign: 'center', width: 90 }}>In-app</th>
                <th style={{ textAlign: 'center', width: 90 }}>Email</th>
                <th style={{ textAlign: 'center', width: 90 }}>SMS</th>
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
                    <td style={{ textAlign: 'center', width: 90 }}>
                      <input
                        type="checkbox"
                        checked={hasOverride}
                        disabled={updatePreferences.isPending}
                        onChange={(e) => toggleCategoryOverride(category, e.target.checked)}
                        aria-label={`Override ${CATEGORY_LABELS[category]}`}
                      />
                    </td>
                    <td style={{ textAlign: 'center', width: 90 }}>
                      <input
                        type="checkbox"
                        checked={effective.inAppEnabled}
                        disabled={!hasOverride || updatePreferences.isPending}
                        onChange={(e) => patchCategoryOverride(category, { inAppEnabled: e.target.checked })}
                        aria-label={`${CATEGORY_LABELS[category]} in-app`}
                      />
                    </td>
                    <td style={{ textAlign: 'center', width: 90 }}>
                      <input
                        type="checkbox"
                        checked={effective.emailEnabled}
                        disabled={!hasOverride || updatePreferences.isPending}
                        onChange={(e) => patchCategoryOverride(category, { emailEnabled: e.target.checked })}
                        aria-label={`${CATEGORY_LABELS[category]} email`}
                      />
                    </td>
                    <td style={{ textAlign: 'center', width: 90 }}>
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
        </div>
      </section>
    </div>
  );
}
