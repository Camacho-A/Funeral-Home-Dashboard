'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { disconnectCrematoryMailbox, fetchCrematorySettings, saveCrematorySettings, startCrematoryMailboxConnection } from '@/lib/crematoryClient';
import { parseRecipientList } from '@/domain/crematory/crematorySettings';
import { formatTimestamp } from '@/utils/format';

/**
 * Send to Crematory (2026-10). Settings → Crematory, administrators only
 * (the API checks organization.manage):
 *   - the crematory's default recipients — entered here, never built in;
 *     staff can still change them on any single email before sending;
 *   - the ONE shared Outlook mailbox packages are sent from. Connecting it
 *     signs in to Microsoft AS that mailbox.
 */
export function CrematorySettingsPanel() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const query = useQuery({ queryKey: ['crematorySettings', organizationId], queryFn: () => fetchCrematorySettings(organizationId) });
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.data) {
      setTo(query.data.settings.to.join(', '));
      setCc(query.data.settings.cc.join(', '));
    }
  }, [query.data]);

  useEffect(() => {
    const connected = searchParams.get('mailboxConnected');
    const error = searchParams.get('mailboxError');
    if (connected) setNotice({ ok: true, message: `Connected ${connected}. Crematory Packages will be sent from this mailbox.` });
    if (error) setNotice({ ok: false, message: error });
  }, [searchParams]);

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      await saveCrematorySettings(organizationId, { to: parseRecipientList(to), cc: parseRecipientList(cc) });
      await queryClient.invalidateQueries({ queryKey: ['crematorySettings', organizationId] });
      setNotice({ ok: true, message: 'Recipients saved.' });
    } catch (error) {
      setNotice({ ok: false, message: error instanceof Error ? error.message : 'The recipients could not be saved.' });
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setNotice(null);
    try {
      const { authorizeUrl } = await startCrematoryMailboxConnection(organizationId);
      window.location.assign(authorizeUrl);
    } catch (error) {
      setNotice({ ok: false, message: error instanceof Error ? error.message : 'Could not start the Microsoft sign-in.' });
    }
  }

  async function disconnect() {
    setNotice(null);
    try {
      await disconnectCrematoryMailbox(organizationId);
      await queryClient.invalidateQueries({ queryKey: ['crematorySettings', organizationId] });
      setNotice({ ok: true, message: 'The mailbox was disconnected. Nothing can be sent to the crematory until one is connected.' });
    } catch (error) {
      setNotice({ ok: false, message: error instanceof Error ? error.message : 'Could not disconnect the mailbox.' });
    }
  }

  if (query.isPending) return <p>Loading…</p>;
  if (query.error) return <div className="sx-form-banner sx-form-banner-error" role="alert">{query.error.message}</div>;
  const mailbox = query.data!.mailbox;

  return (
    <div className="sx-form-grid">
      {notice && (
        <div className={`sx-span-all sx-form-banner ${notice.ok ? 'sx-form-banner-info' : 'sx-form-banner-error'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.message}
        </div>
      )}

      <section className="sx-span-all">
        <h2 className="sx-section-title">Outlook mailbox</h2>
        {mailbox.connected ? (
          <p>
            Sending from <strong>{mailbox.accountEmail}</strong> — connected {formatTimestamp(mailbox.connectedAt)}.
            {mailbox.status === 'reauth_required' && <strong> This mailbox needs to be signed in again.</strong>}
          </p>
        ) : (
          <p>No mailbox is connected. Crematory Packages cannot be sent until one is.</p>
        )}
        {!mailbox.configured && <p>Outlook sending is not set up on this server yet (Microsoft app settings are missing).</p>}
        <p>
          Connecting opens Microsoft sign-in. Sign in <strong>as the shared mailbox</strong> the crematory should receive email from.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="sx-btn sx-btn-secondary" onClick={connect} disabled={!mailbox.configured}>
            {mailbox.connected ? 'Reconnect mailbox' : 'Connect Outlook mailbox'}
          </button>
          {mailbox.connected && (
            <button type="button" className="sx-btn sx-btn-ghost" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>
      </section>

      <section className="sx-span-all">
        <h2 className="sx-section-title">Crematory recipients</h2>
        <p>Used to start every Send to Crematory email. Staff can change them before sending.</p>
        <div className="sx-field">
          <label className="sx-label" htmlFor="crematory-settings-to">
            To
          </label>
          <input id="crematory-settings-to" className="sx-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="intake@crematory.com" />
        </div>
        <div className="sx-field">
          <label className="sx-label" htmlFor="crematory-settings-cc">
            CC
          </label>
          <input id="crematory-settings-cc" className="sx-input" value={cc} onChange={(e) => setCc(e.target.value)} />
        </div>
        <button type="button" className="sx-btn sx-btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save recipients'}
        </button>
      </section>
    </div>
  );
}
