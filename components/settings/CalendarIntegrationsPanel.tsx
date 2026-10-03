'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import {
  useCalendarConnections,
  useDisconnectCalendarConnection,
  useBeginCalendarConnect,
  useReminderPolicy,
  useUpdateReminderPolicy,
  useCalendarFeedTokens,
  useGenerateCalendarFeedToken,
  useRevokeCalendarFeedToken,
} from '@/hooks/useCalendarIntegrations';
import type { CalendarConnectionStatus, CalendarProviderName } from '@/types/calendarConnection';

const PROVIDER_LABEL: Record<CalendarProviderName, string> = { google: 'Google Calendar', microsoft: 'Microsoft Outlook' };

const STATUS_LABEL: Record<CalendarConnectionStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  reauth_required: 'Reconnect needed',
  error: 'Error',
};

const STATUS_CLASS: Record<CalendarConnectionStatus, string> = {
  connected: 'sx-status sx-status-ok',
  disconnected: 'sx-status',
  reauth_required: 'sx-status sx-status-bad',
  error: 'sx-status sx-status-bad',
};

const LEAD_TIME_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 120, label: '2 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 4320, label: '3 days before' },
  { minutes: 10080, label: '7 days before' },
];

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). "Settings > Calendar Integrations" — connecting/
 * disconnecting your OWN Google/Microsoft calendar and managing your
 * OWN personal ICS feed link need no permission beyond authentication
 * (mirrors `NotificationPreferencesPanel`'s self-scoped posture
 * exactly, §10/§19 of the plan). The reminder-policy editor is the one
 * `calendar.manage`-gated section on this page — its controls are
 * disabled (not hidden) for a caller without that permission, so the
 * current org-wide policy is still visible to everyone with
 * `schedule.read`. Deliberately kept on this single page rather than a
 * separate "Settings > Scheduling" page — the plan named that split as
 * an implementation-time choice, and the two concerns (calendar
 * connections, reminder timing) are small enough to share one page
 * without crowding it.
 */
export function CalendarIntegrationsPanel() {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const canManageCalendar = myPermissionsQuery.isSuccess && myPermissionsQuery.data.permissions.includes('calendar.manage');

  const connectionsQuery = useCalendarConnections(organizationId);
  const disconnectMutation = useDisconnectCalendarConnection(organizationId);
  const beginConnectMutation = useBeginCalendarConnect(organizationId);

  const reminderPolicyQuery = useReminderPolicy(organizationId);
  const updateReminderPolicy = useUpdateReminderPolicy(organizationId);

  const feedTokensQuery = useCalendarFeedTokens(organizationId);
  const generateFeedToken = useGenerateCalendarFeedToken(organizationId);
  const revokeFeedToken = useRevokeCalendarFeedToken(organizationId);
  const [newRawToken, setNewRawToken] = useState<string | null>(null);

  function connect(provider: CalendarProviderName) {
    beginConnectMutation.mutate(provider, {
      onSuccess: (authorizeUrl) => {
        window.location.assign(authorizeUrl);
      },
    });
  }

  async function handleGenerateToken() {
    setNewRawToken(null);
    const result = await generateFeedToken.mutateAsync();
    setNewRawToken(result.rawToken);
  }

  function toggleLeadTime(minutes: number, checked: boolean) {
    const current = reminderPolicyQuery.data?.leadTimesMinutes ?? [];
    const next = checked ? [...current, minutes].sort((a, b) => a - b) : current.filter((m) => m !== minutes);
    updateReminderPolicy.mutate({ leadTimesMinutes: next });
  }

  const connections = connectionsQuery.data ?? [];
  const feedTokens = feedTokensQuery.data ?? [];
  const activeFeedTokens = feedTokens.filter((t) => t.revokedAt === null);

  return (
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Calendar Integrations</h2>
      </div>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Connected calendars</h3>
        <p className="sx-settings-section-desc">Push your SOLIS appointments to your own Google or Microsoft calendar. Sync is one-way — changes made here reach your calendar, never the other way around.</p>

        {connectionsQuery.isPending && <p className="sx-help">Loading connections…</p>}
        {connectionsQuery.isError && <div className="sx-error-state" role="alert">Couldn&rsquo;t load calendar connections. Please try again.</div>}

        {connectionsQuery.isSuccess &&
          connections.map((connection) => (
            <div key={connection.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, borderBottom: '1px solid var(--sx-border-soft)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="sx-cell-title" style={{ display: 'block' }}>
                  {PROVIDER_LABEL[connection.provider]} — {connection.externalAccountEmail}
                </span>
                <span className="sx-cell-sub">{connection.lastSyncAt ? `Last synced ${new Date(connection.lastSyncAt).toLocaleString()}` : 'Not yet synced'}</span>
              </div>
              <span className={STATUS_CLASS[connection.status]}>{STATUS_LABEL[connection.status]}</span>
              <button type="button" className="sx-btn sx-btn-danger sx-btn-sm" disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate(connection.id)}>
                Disconnect
              </button>
            </div>
          ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="sx-btn sx-btn-secondary" disabled={beginConnectMutation.isPending} onClick={() => connect('google')}>
            Connect Google Calendar
          </button>
          <button type="button" className="sx-btn sx-btn-secondary" disabled={beginConnectMutation.isPending} onClick={() => connect('microsoft')}>
            Connect Microsoft Outlook
          </button>
        </div>
        {beginConnectMutation.isError && <div className="sx-error-state" role="alert" style={{ marginTop: 8 }}>{beginConnectMutation.error.message}</div>}
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Appointment reminders</h3>
        <p className="sx-settings-section-desc">Organization-wide reminder timing for scheduled appointments.{!canManageCalendar && ' Only an administrator or manager can change these settings.'}</p>

        {reminderPolicyQuery.isPending && <p className="sx-help">Loading reminder policy…</p>}
        {reminderPolicyQuery.isError && <div className="sx-error-state" role="alert">Couldn&rsquo;t load the reminder policy. Please try again.</div>}

        {reminderPolicyQuery.isSuccess && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {LEAD_TIME_OPTIONS.map((option) => (
                <label key={option.minutes} className="sx-check">
                  <input
                    type="checkbox"
                    checked={reminderPolicyQuery.data.leadTimesMinutes.includes(option.minutes)}
                    disabled={!canManageCalendar || updateReminderPolicy.isPending}
                    onChange={(e) => toggleLeadTime(option.minutes, e.target.checked)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <label className="sx-check">
              <input
                type="checkbox"
                checked={reminderPolicyQuery.data.notifyOwner}
                disabled={!canManageCalendar || updateReminderPolicy.isPending}
                onChange={(e) => updateReminderPolicy.mutate({ notifyOwner: e.target.checked })}
              />
              Notify the appointment owner
            </label>
            <label className="sx-check">
              <input
                type="checkbox"
                checked={reminderPolicyQuery.data.notifyFamily}
                disabled={!canManageCalendar || updateReminderPolicy.isPending}
                onChange={(e) => updateReminderPolicy.mutate({ notifyFamily: e.target.checked })}
              />
              Notify family portal users
            </label>
          </>
        )}
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Personal calendar feed</h3>
        <p className="sx-settings-section-desc">Subscribe to your own appointments from any calendar app (Google Calendar, Apple Calendar, Outlook) using a private link.</p>

        {feedTokensQuery.isPending && <p className="sx-help">Loading feed links…</p>}
        {feedTokensQuery.isError && <div className="sx-error-state" role="alert">Couldn&rsquo;t load feed links. Please try again.</div>}

        {feedTokensQuery.isSuccess &&
          activeFeedTokens.map((token) => (
            <div key={token.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, borderBottom: '1px solid var(--sx-border-soft)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="sx-cell-title" style={{ display: 'block' }}>Created {new Date(token.createdAt).toLocaleDateString()}</span>
                <span className="sx-cell-sub">{token.lastAccessedAt ? `Last fetched ${new Date(token.lastAccessedAt).toLocaleString()}` : 'Never fetched yet'}</span>
              </div>
              <button type="button" className="sx-btn sx-btn-danger sx-btn-sm" disabled={revokeFeedToken.isPending} onClick={() => revokeFeedToken.mutate(token.id)}>
                Revoke
              </button>
            </div>
          ))}

        <div style={{ marginTop: 12 }}>
          <button type="button" className="sx-btn sx-btn-secondary" disabled={generateFeedToken.isPending} onClick={handleGenerateToken}>
            Generate new feed link
          </button>
        </div>

        {newRawToken && (
          <div className="sx-form-banner sx-form-banner-info" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8, marginTop: 12 }}>
            <p className="sx-help" style={{ margin: 0 }}>Copy this link now — it won&rsquo;t be shown again. Add it to your calendar app as a subscribed calendar.</p>
            <span className="sx-mono" style={{ wordBreak: 'break-all' }}>{`${typeof window !== 'undefined' ? window.location.origin : ''}/api/calendar-feed/${newRawToken}`}</span>
            <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setNewRawToken(null)}>
              Done
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
