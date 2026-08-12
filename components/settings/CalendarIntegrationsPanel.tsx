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
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import type { CalendarConnectionStatus, CalendarProviderName } from '@/types/calendarConnection';
import styles from './CalendarIntegrationsPanel.module.css';

const PROVIDER_LABEL: Record<CalendarProviderName, string> = { google: 'Google Calendar', microsoft: 'Microsoft Outlook' };

const STATUS_LABEL: Record<CalendarConnectionStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  reauth_required: 'Reconnect needed',
  error: 'Error',
};

const STATUS_VARIANT: Record<CalendarConnectionStatus, BadgeVariant> = {
  connected: 'success',
  disconnected: 'neutral',
  reauth_required: 'danger',
  error: 'danger',
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
    <div className={styles.sections}>
      <Card className={styles.card}>
        <h3 className={styles.sectionTitle}>Connected calendars</h3>
        <p className={styles.hint}>Push your Beacon appointments to your own Google or Microsoft calendar. Sync is one-way — changes made here reach your calendar, never the other way around.</p>

        {connectionsQuery.isPending && <p className={styles.loading}>Loading connections…</p>}
        {connectionsQuery.isError && <p className={styles.errorText}>Couldn&rsquo;t load calendar connections. Please try again.</p>}

        {connectionsQuery.isSuccess &&
          connections.map((connection) => (
            <div key={connection.id} className={styles.connectionRow}>
              <div className={styles.connectionInfo}>
                <span className={styles.connectionEmail}>
                  {PROVIDER_LABEL[connection.provider]} — {connection.externalAccountEmail}
                </span>
                <span className={styles.connectionMeta}>{connection.lastSyncAt ? `Last synced ${new Date(connection.lastSyncAt).toLocaleString()}` : 'Not yet synced'}</span>
              </div>
              <div className={styles.buttonRow}>
                <Badge variant={STATUS_VARIANT[connection.status]}>{STATUS_LABEL[connection.status]}</Badge>
                <Button variant="danger" disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate(connection.id)}>
                  Disconnect
                </Button>
              </div>
            </div>
          ))}

        <div className={styles.buttonRow}>
          <Button variant="secondary" disabled={beginConnectMutation.isPending} onClick={() => connect('google')}>
            Connect Google Calendar
          </Button>
          <Button variant="secondary" disabled={beginConnectMutation.isPending} onClick={() => connect('microsoft')}>
            Connect Microsoft Outlook
          </Button>
        </div>
        {beginConnectMutation.isError && <p className={styles.errorText}>{beginConnectMutation.error.message}</p>}
      </Card>

      <Card className={styles.card}>
        <h3 className={styles.sectionTitle}>Appointment reminders</h3>
        <p className={styles.hint}>Organization-wide reminder timing for scheduled appointments.{!canManageCalendar && ' Only an administrator or manager can change these settings.'}</p>

        {reminderPolicyQuery.isPending && <p className={styles.loading}>Loading reminder policy…</p>}
        {reminderPolicyQuery.isError && <p className={styles.errorText}>Couldn&rsquo;t load the reminder policy. Please try again.</p>}

        {reminderPolicyQuery.isSuccess && (
          <>
            <div className={styles.leadTimeGrid}>
              {LEAD_TIME_OPTIONS.map((option) => (
                <label key={option.minutes} className={styles.checkboxLabel}>
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
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={reminderPolicyQuery.data.notifyOwner}
                disabled={!canManageCalendar || updateReminderPolicy.isPending}
                onChange={(e) => updateReminderPolicy.mutate({ notifyOwner: e.target.checked })}
              />
              Notify the appointment owner
            </label>
            <label className={styles.checkboxLabel}>
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
      </Card>

      <Card className={styles.card}>
        <h3 className={styles.sectionTitle}>Personal calendar feed</h3>
        <p className={styles.hint}>Subscribe to your own appointments from any calendar app (Google Calendar, Apple Calendar, Outlook) using a private link.</p>

        {feedTokensQuery.isPending && <p className={styles.loading}>Loading feed links…</p>}
        {feedTokensQuery.isError && <p className={styles.errorText}>Couldn&rsquo;t load feed links. Please try again.</p>}

        {feedTokensQuery.isSuccess &&
          activeFeedTokens.map((token) => (
            <div key={token.id} className={styles.tokenRow}>
              <div className={styles.connectionInfo}>
                <span className={styles.connectionEmail}>Created {new Date(token.createdAt).toLocaleDateString()}</span>
                <span className={styles.connectionMeta}>{token.lastAccessedAt ? `Last fetched ${new Date(token.lastAccessedAt).toLocaleString()}` : 'Never fetched yet'}</span>
              </div>
              <Button variant="danger" disabled={revokeFeedToken.isPending} onClick={() => revokeFeedToken.mutate(token.id)}>
                Revoke
              </Button>
            </div>
          ))}

        <div>
          <Button variant="secondary" disabled={generateFeedToken.isPending} onClick={handleGenerateToken}>
            Generate new feed link
          </Button>
        </div>

        {newRawToken && (
          <div className={styles.rawTokenBox}>
            <p className={styles.hint}>Copy this link now — it won&rsquo;t be shown again. Add it to your calendar app as a subscribed calendar.</p>
            <span className={styles.rawTokenUrl}>{`${typeof window !== 'undefined' ? window.location.origin : ''}/api/calendar-feed/${newRawToken}`}</span>
            <Button variant="ghost" onClick={() => setNewRawToken(null)}>
              Done
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
