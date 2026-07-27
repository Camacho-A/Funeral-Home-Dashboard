'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import { useIdentitySessions, useRevokeSession, useSignOutEverywhere } from '@/hooks/useIdentitySessions';
import { useChangePassword } from '@/hooks/useChangePassword';
import styles from './SecuritySettingsPanel.module.css';

/**
 * Phase 21 (Identity, Authentication & Session Management). "Security
 * Settings" + "Manage Sessions" + basic "Account Settings" identity info,
 * consolidated into one page — the same kind of deliberate consolidation
 * this phase already made for invitations (no dedicated collection) and
 * login/logout (no redundant REST route): three separately-named UI pages
 * in the spec whose actual content (this identity's own security posture)
 * is small enough, and interrelated enough, to not warrant three separate
 * routes. Only ever rendered for `AUTH_ADAPTER=identity` — see
 * app/(portal)/settings/security/page.tsx.
 */
export function SecuritySettingsPanel() {
  const router = useRouter();
  const sessionsQuery = useIdentitySessions();
  const revokeSession = useRevokeSession();
  const signOutEverywhere = useSignOutEverywhere();
  const changePassword = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [keepCurrentSession, setKeepCurrentSession] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (newPassword.length < 8) {
      setFormError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('New passwords do not match.');
      return;
    }

    try {
      const result = await changePassword.mutateAsync({ currentPassword, newPassword, keepCurrentSession });
      if (result.signedOutEverywhere) {
        router.push('/login?notice=password_reset');
        return;
      }
      setFormSuccess('Password changed. Other devices have been signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    }
  }

  async function handleSignOutEverywhere() {
    await signOutEverywhere.mutateAsync();
    router.push('/login?notice=password_reset');
  }

  return (
    <div>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Change password</h2>
        <Card>
          <form className={styles.form} onSubmit={handleChangePassword}>
            {formError && <div className={styles.error} role="alert">{formError}</div>}
            {formSuccess && <div className={styles.success} role="status">{formSuccess}</div>}
            <label className={styles.label}>
              Current password
              <TextField
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label className={styles.label}>
              New password
              <TextField
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label className={styles.label}>
              Confirm new password
              <TextField
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={keepCurrentSession}
                onChange={(e) => setKeepCurrentSession(e.target.checked)}
              />
              Keep me signed in on this device
            </label>
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending ? 'Changing password…' : 'Change password'}
            </Button>
          </form>
        </Card>
      </section>

      <section className={styles.section}>
        <div className={styles.sessionsHeader}>
          <h2 className={styles.sectionTitle}>Active sessions</h2>
          <Button variant="danger" onClick={handleSignOutEverywhere} disabled={signOutEverywhere.isPending}>
            Sign out everywhere
          </Button>
        </div>
        <Card>
          {sessionsQuery.isPending && <p>Loading sessions…</p>}
          {sessionsQuery.data && sessionsQuery.data.length === 0 && (
            <EmptyState message="No active sessions." />
          )}
          {sessionsQuery.data?.map((session) => (
            <div key={session.id} className={styles.sessionRow}>
              <div className={styles.sessionInfo}>
                <div className={styles.sessionDevice}>
                  {session.deviceName ?? 'Unknown device'} {session.isCurrent && '· This device'}
                  {session.rememberDevice && ' · Remembered'}
                </div>
                <div className={styles.sessionMeta}>
                  {session.ipAddress ?? 'Unknown location'} · Last seen {formatTimestamp(session.lastSeenAt)}
                </div>
              </div>
              {!session.isCurrent && (
                <Button
                  variant="secondary"
                  onClick={() => revokeSession.mutate(session.id)}
                  disabled={revokeSession.isPending}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
