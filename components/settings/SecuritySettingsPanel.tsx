'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import { useOrganization } from '@/hooks/useOrganization';
import { useIdentitySessions, useRevokeSession, useSignOutEverywhere } from '@/hooks/useIdentitySessions';
import { useChangePassword } from '@/hooks/useChangePassword';
import { useMyIdentityProfile, useUpdateMyPhone } from '@/hooks/useIdentityProfile';
import { MfaPanel } from './MfaPanel';

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
 *
 * Phase 33 (Real Notification Delivery) adds the one editable profile
 * field this page never had before this phase: `phone`, the gate for the
 * SMS notification channel (`components/settings/NotificationPreferencesPanel.tsx`).
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S4): each block
 * becomes a `.sx-settings-section`. The "Profile" section here is just
 * the editable phone field (no other static read-only identity fields
 * exist in this component) — the spec's literal `<dl class="sx-kv">`
 * read-only example doesn't apply; restyled with the form system
 * instead, per §6's "if something doesn't match, production is the
 * source of truth." Active sessions: rows with `min-height:52px` and a
 * `--sx-border-soft` divider, device/browser as `.sx-cell-title`,
 * location/last-active as `.sx-cell-sub`, "Current" in muted text, and
 * the per-session sign-out as `sx-btn-ghost sx-btn-sm` in red.
 */
export function SecuritySettingsPanel() {
  const router = useRouter();
  const { organizationId } = useOrganization();
  const sessionsQuery = useIdentitySessions();
  const revokeSession = useRevokeSession();
  const signOutEverywhere = useSignOutEverywhere();
  const changePassword = useChangePassword();
  const profileQuery = useMyIdentityProfile(organizationId);
  const updatePhone = useUpdateMyPhone(organizationId);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [keepCurrentSession, setKeepCurrentSession] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSuccess, setPhoneSuccess] = useState(false);

  useEffect(() => {
    setPhoneDraft(profileQuery.data?.phone ?? '');
  }, [profileQuery.data?.phone]);

  async function handleSavePhone(event: React.FormEvent) {
    event.preventDefault();
    setPhoneError(null);
    setPhoneSuccess(false);
    try {
      await updatePhone.mutateAsync(phoneDraft.trim() === '' ? null : phoneDraft.trim());
      setPhoneSuccess(true);
    } catch (error) {
      setPhoneError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    }
  }

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
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Security</h2>
        <p className="sx-settings-desc">Change your password and manage active sessions.</p>
      </div>

      <section className="sx-settings-section">
        <div className="sx-settings-section-head">
          <div>
            <h3 className="sx-settings-section-title">Profile</h3>
          </div>
        </div>
        <form onSubmit={handleSavePhone}>
          <div className="sx-form-grid">
            <div className="sx-field">
              <label className="sx-label" htmlFor="security-phone">
                Phone number
              </label>
              <TextField
                className="sx-input"
                id="security-phone"
                type="tel"
                autoComplete="tel"
                placeholder="+1 555 555 0100"
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                disabled={profileQuery.isPending}
              />
              <p className="sx-help">Used only for SMS notifications, if you enable them in Notification settings. Leave blank to remove it.</p>
            </div>
          </div>
          <div className="sx-save-row">
            <span className="sx-save-state" data-state={phoneError ? 'error' : phoneSuccess ? 'saved' : undefined} role={phoneError ? 'alert' : phoneSuccess ? 'status' : undefined}>
              {phoneError ? phoneError : phoneSuccess ? 'Phone number saved.' : ''}
            </span>
            <button type="submit" className="sx-btn sx-btn-primary" disabled={updatePhone.isPending}>
              {updatePhone.isPending ? 'Saving…' : 'Save phone number'}
            </button>
          </div>
        </form>
      </section>

      <section className="sx-settings-section">
        <div className="sx-settings-section-head">
          <div>
            <h3 className="sx-settings-section-title">Change password</h3>
          </div>
        </div>
        <form onSubmit={handleChangePassword}>
          {formError && (
            <div className="sx-form-banner sx-form-banner-error" role="alert">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="sx-form-banner sx-form-banner-info" role="status">
              {formSuccess}
            </div>
          )}
          <div className="sx-form-grid">
            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="security-current-password">
                Current password
              </label>
              <TextField
                className="sx-input"
                id="security-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="sx-field">
              <label className="sx-label" htmlFor="security-new-password">
                New password
              </label>
              <TextField
                className="sx-input"
                id="security-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="sx-field">
              <label className="sx-label" htmlFor="security-confirm-password">
                Confirm new password
              </label>
              <TextField
                className="sx-input"
                id="security-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="sx-span-all">
              <label className="sx-check">
                <input type="checkbox" checked={keepCurrentSession} onChange={(e) => setKeepCurrentSession(e.target.checked)} />
                Keep me signed in on this device
              </label>
            </div>
          </div>
          <div className="sx-save-row">
            <button type="submit" className="sx-btn sx-btn-primary" disabled={changePassword.isPending}>
              {changePassword.isPending ? 'Changing password…' : 'Change password'}
            </button>
          </div>
        </form>
      </section>

      <section className="sx-settings-section">
        <MfaPanel />
      </section>

      <section className="sx-settings-section">
        <div className="sx-settings-section-head">
          <div>
            <h3 className="sx-settings-section-title">Active sessions</h3>
          </div>
          <button type="button" className="sx-btn sx-btn-danger" onClick={handleSignOutEverywhere} disabled={signOutEverywhere.isPending}>
            Sign out everywhere
          </button>
        </div>
        {sessionsQuery.isPending && (
          <div className="sx-loading" aria-busy="true">
            <span className="sx-skeleton" style={{ width: '90%' }} />
            <span className="sx-skeleton" style={{ width: '70%' }} />
            <span className="sr-only">Loading sessions…</span>
          </div>
        )}
        {sessionsQuery.data && sessionsQuery.data.length === 0 && <EmptyState message="No active sessions." />}
        {sessionsQuery.data?.map((session) => (
          <div
            key={session.id}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 52, borderBottom: '1px solid var(--sx-border-soft)' }}
          >
            <div>
              <div className="sx-cell-title">
                {session.deviceName ?? 'Unknown device'} {session.isCurrent && <span style={{ color: 'var(--sx-muted)', fontWeight: 400 }}>· Current</span>}
              </div>
              <div className="sx-cell-sub">
                {session.ipAddress ?? 'Unknown location'} · Last seen {formatTimestamp(session.lastSeenAt)}
              </div>
            </div>
            {!session.isCurrent && (
              <button
                type="button"
                className="sx-btn sx-btn-ghost sx-btn-sm"
                style={{ color: 'var(--sx-red)' }}
                onClick={() => revokeSession.mutate(session.id)}
                disabled={revokeSession.isPending}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
