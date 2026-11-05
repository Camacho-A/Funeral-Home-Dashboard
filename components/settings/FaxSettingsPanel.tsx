'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { Modal } from '@/components/ui/Modal';
import {
  addFaxDestination,
  archiveFaxDestination,
  restoreFaxDestination,
  editFaxDestination,
  fetchFaxConfigurationHistory,
  fetchFaxSettings,
  makeDefaultFaxDestination,
  saveFaxSettings,
  type FaxSettingsOverview,
} from '@/lib/faxSettingsClient';
import { formatTimestamp } from '@/utils/format';
import { renderFaxTemplate, validateBodyTemplate, validateSubjectTemplate } from '@/domain/faxBundles/faxTemplates';
import { normalizeFaxNumber } from '@/domain/faxBundles/faxConfiguration';
import styles from './FaxSettingsPanel.module.css';

/**
 * Fax Settings (2026-11). Settings → Fax Settings, administrators only (the
 * API checks organization.manage). Each organization's own destinations,
 * provider, subject and message templates and cover page choice.
 *
 * What this page can NOT do, by design: turn fax sending on, change the
 * attachment limit, or switch on a message or cover page the provider has
 * not been verified for. A bundle already prepared keeps what it was
 * previewed with; if these settings change, Send Fax refuses it (nothing
 * sent) and staff preview again.
 */
type Destination = FaxSettingsOverview['destinations'][number];
type Notice = { ok: boolean; message: string } | null;

const CAPABILITY_LABEL = { supported: 'Verified', unverified: 'Not verified', unsupported: 'Not available' } as const;

export function FaxSettingsPanel() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['faxSettings', organizationId], queryFn: () => fetchFaxSettings(organizationId) });
  const history = useQuery({ queryKey: ['faxSettingsHistory', organizationId], queryFn: () => fetchFaxConfigurationHistory(organizationId) });
  const [notice, setNotice] = useState<Notice>(null);
  /** A refused destination save is shown in its form, where staff are looking. */
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Templates and options — one Save.
  const [providerKey, setProviderKey] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyEnabled, setBodyEnabled] = useState(false);
  const [body, setBody] = useState('');
  const [coverPage, setCoverPage] = useState(false);
  useEffect(() => {
    if (!query.data) return;
    setProviderKey(query.data.settings.providerKey);
    setSubject(query.data.settings.subjectTemplate);
    setBodyEnabled(query.data.settings.bodyEnabled);
    setBody(query.data.settings.bodyTemplate);
    setCoverPage(query.data.settings.coverPageEnabled);
  }, [query.data]);

  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', faxNumber: '', purpose: '', makeDefault: false });
  const [showArchived, setShowArchived] = useState(false);
  /** The destination waiting for "Archive destination" to be confirmed. */
  const [confirmArchive, setConfirmArchive] = useState<Destination | null>(null);

  async function run(key: string, action: () => Promise<FaxSettingsOverview>, success: string) {
    setBusy(key);
    setNotice(null);
    setFormError(null);
    try {
      const overview = await action();
      queryClient.setQueryData(['faxSettings', organizationId], overview);
      await queryClient.invalidateQueries({ queryKey: ['faxSettingsHistory', organizationId] });
      setNotice({ ok: true, message: success });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'That could not be saved.';
      if (key === 'destination') setFormError(message);
      else setNotice({ ok: false, message });
      await queryClient.invalidateQueries({ queryKey: ['faxSettings', organizationId] });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const data = query.data;
  const provider = useMemo(() => data?.providers.find((p) => p.key === providerKey) ?? data?.provider ?? null, [data, providerKey]);
  const subjectExample = useMemo(() => renderFaxTemplate(subject, { reference: 'DC-7Q4K9M', organizationName: data?.organizationName ?? '', applicationCount: 3, pageCount: 3 }), [subject, data]);
  // The server's own checks, run as staff type — the same words, before Save.
  const subjectProblem = useMemo(() => problemOf(() => validateSubjectTemplate(subject)), [subject]);
  const bodyProblem = useMemo(() => problemOf(() => validateBodyTemplate(body)), [body]);

  if (query.isPending) return <p>Loading…</p>;
  if (query.error || !data || !provider) return <div className="sx-form-banner sx-form-banner-error" role="alert">{query.error?.message ?? 'Fax Settings could not be loaded.'}</div>;

  const settingsDirty =
    providerKey !== data.settings.providerKey ||
    subject !== data.settings.subjectTemplate ||
    bodyEnabled !== data.settings.bodyEnabled ||
    body !== data.settings.bodyTemplate ||
    coverPage !== data.settings.coverPageEnabled;
  const bodyAllowed = provider.emailBody === 'supported';
  const coverAllowed = provider.coverPage === 'supported';
  const visible = data.destinations.filter((d) => showArchived || d.status === 'active');
  const archivedCount = data.destinations.filter((d) => d.status === 'archived').length;
  const activeCount = data.destinations.filter((d) => d.status === 'active').length;
  const defaultRevision = data.settings.revision;

  function startEdit(d: Destination) {
    setFormError(null);
    setEditing(d.id);
    setForm({ name: d.name, faxNumber: d.faxNumberDisplay, purpose: d.builtIn ? '' : d.purpose, makeDefault: false });
  }
  function startAdd() {
    setFormError(null);
    setEditing('new');
    setForm({ name: '', faxNumber: '', purpose: '', makeDefault: false });
  }

  async function saveDestination() {
    const ok =
      editing === 'new'
        ? await run('destination', () => addFaxDestination(organizationId, form), `${form.name || 'Destination'} added.`)
        : await run(
            'destination',
            () => editFaxDestination(organizationId, editing!, { expectedRevision: data!.destinations.find((d) => d.id === editing)?.revision ?? 0, name: form.name, faxNumber: form.faxNumber, purpose: form.purpose }),
            'Destination saved. A bundle already prepared for the old details will ask staff to preview again.',
          );
    if (ok) setEditing(null);
  }

  return (
    <div className={styles.panel}>
      {notice && (
        <div className={`sx-form-banner ${notice.ok ? styles.success : 'sx-form-banner-error'}`} role={notice.ok ? 'status' : 'alert'}>
          <span>{notice.message}</span>
        </div>
      )}

      <div className={`sx-form-banner ${data.sendingEnabled ? 'sx-form-banner-info' : styles.caution}`} role="status">
        <span>
          <strong>Fax sending is {data.sendingEnabled ? 'on' : 'off'}.</strong>{' '}
          {data.sendingEnabled
            ? 'Changes here apply to bundles prepared from now on.'
            : 'Bundles can be prepared and previewed. Sending is turned on by SOLIS only after a verified test delivery — not from this page.'}
        </span>
      </div>
      {data.problem && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {data.problem}
        </div>
      )}

      {/* 1 ------------------------------------------------------------ */}
      <section className={styles.section} aria-labelledby="fax-destinations">
        <h2 id="fax-destinations" className="sx-section-title">
          Fax Destinations
          {archivedCount > 0 && (
            <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
            </button>
          )}
        </h2>
        <p className={styles.lead}>
          The default is preselected when staff send a fax; they can choose any other active destination. Destinations are never deleted — archive one you no longer use, and restore it if you need it again.
        </p>
        <ul className={styles.destinations}>
          {visible.map((d) => (
            <li key={d.id} className={`${styles.destination} ${d.status === 'archived' ? styles.archived : ''} ${d.isDefault ? styles.isDefault : ''}`}>
              {editing === d.id ? (
                <DestinationForm form={form} setForm={setForm} isNew={false} busy={busy === 'destination'} error={formError} onCancel={() => setEditing(null)} onSave={saveDestination} />
              ) : (
                <>
                  <div className={styles.destinationText}>
                    <span className={styles.destinationName}>
                      {d.name}
                      {d.status === 'archived' ? (
                        <span className={`${styles.chip} ${styles.chipArchived}`}>Archived</span>
                      ) : d.isDefault ? (
                        <span className={`${styles.chip} ${styles.chipDefault}`}>Default</span>
                      ) : (
                        <span className={`${styles.chip} ${styles.chipActive}`}>Active</span>
                      )}
                    </span>
                    <span className={styles.nowrap}>Fax {d.faxNumberDisplay}</span>
                    <span className="sx-help">
                      {d.address}
                      {d.builtIn ? ' · Built into SOLIS for your organization. Editing it saves your own copy here.' : d.purpose ? ` · ${d.purpose}` : ''}
                    </span>
                  </div>
                  {d.status === 'active' && (
                    <div className={styles.actions}>
                      <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy !== null} onClick={() => startEdit(d)}>
                        Edit
                      </button>
                      {!d.isDefault && (
                        <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy !== null} onClick={() => run('default', () => makeDefaultFaxDestination(organizationId, d.id, defaultRevision), `${d.name} is now the default destination.`)}>
                          Make default
                        </button>
                      )}
                      {!d.isDefault && !d.builtIn && activeCount > 1 && (
                        <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" disabled={busy !== null} onClick={() => setConfirmArchive(d)}>
                          Archive…
                        </button>
                      )}
                      {d.isDefault && <span className="sx-help">The default cannot be archived — make another destination the default first.</span>}
                    </div>
                  )}
                  {d.status === 'archived' && (
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="sx-btn sx-btn-secondary sx-btn-sm"
                        disabled={busy !== null}
                        onClick={() => run('restore', () => restoreFaxDestination(organizationId, d.id, d.revision ?? 0), `${d.name} restored. It is active again but not the default.`)}
                      >
                        {busy === 'restore' ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        {editing === 'new' ? (
          <div className={styles.destination}>
            <DestinationForm form={form} setForm={setForm} isNew busy={busy === 'destination'} error={formError} onCancel={() => setEditing(null)} onSave={saveDestination} />
          </div>
        ) : (
          <div>
            <button type="button" className="sx-btn sx-btn-secondary" disabled={busy !== null || editing !== null} onClick={startAdd}>
              Add destination
            </button>
          </div>
        )}
      </section>

      {/* 2 ------------------------------------------------------------ */}
      <section className={styles.section} aria-labelledby="fax-provider">
        <h2 id="fax-provider" className="sx-section-title">
          Provider &amp; Sending Mailbox
        </h2>
        <div className="sx-form-grid">
          <div className="sx-field">
            <label className="sx-label" htmlFor="fax-provider-select">
              Fax provider
            </label>
            <select id="fax-provider-select" className="sx-select" value={providerKey} onChange={(e) => setProviderKey(e.target.value)} disabled={data.providers.length < 2}>
              {data.providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="sx-help">Email-to-fax through {provider.gatewayDomain}. Provider credentials, if one ever needs them, are kept on the server — never on this page.</span>
          </div>
          <div className="sx-field">
            <span className="sx-label">Sending mailbox</span>
            {data.mailbox.connected ? (
              <span>
                <strong className={styles.breakAll}>{data.mailbox.accountEmail}</strong>
                {data.mailbox.needsReconnect && <span className={styles.warn}> — needs to be signed in again</span>}
              </span>
            ) : (
              <span className={styles.warn}>No Outlook mailbox is connected.</span>
            )}
            <span className="sx-help">
              Faxes are emailed from the organization&rsquo;s connected Outlook mailbox — the same one Crematory Packages use. Connect or change it in{' '}
              <Link href="/settings/crematory">Settings → Crematory</Link>.
            </span>
          </div>
        </div>
        <dl className={styles.capabilities}>
          <div>
            <dt>Email message</dt>
            <dd>{CAPABILITY_LABEL[provider.emailBody]}</dd>
          </div>
          <div>
            <dt>Cover page</dt>
            <dd>{CAPABILITY_LABEL[provider.coverPage]}</dd>
          </div>
        </dl>
        <p className="sx-help">{provider.notes}</p>
      </section>

      {/* 3 ------------------------------------------------------------ */}
      <section className={styles.section} aria-labelledby="fax-templates">
        <h2 id="fax-templates" className="sx-section-title">
          Email Subject &amp; Message Templates
        </h2>
        <div className="sx-field">
          <label className="sx-label" htmlFor="fax-subject">
            Email subject
          </label>
          <input id="fax-subject" className="sx-input" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} aria-invalid={subjectProblem ? 'true' : undefined} aria-describedby="fax-subject-help" />
          <span id="fax-subject-help" className={subjectProblem ? styles.fieldError : 'sx-help'}>
            {subjectProblem ?? (
              <>
                Must include <code>{'{reference}'}</code>. Example: <span className={styles.breakAll}>{subjectExample}</span>
              </>
            )}
          </span>
        </div>
        <ul className={styles.placeholders} aria-label="Placeholders">
          {data.placeholders.map((p) => (
            <li key={p.key}>
              <code>{`{${p.key}}`}</code> — {p.description}
            </li>
          ))}
        </ul>
        <p className="sx-help">Plain text only. Decedent and case details are never allowed in fax emails.</p>

        <div className="sx-field">
          <label className={styles.check}>
            <input type="checkbox" checked={bodyEnabled} disabled={!bodyAllowed && !bodyEnabled} onChange={(e) => setBodyEnabled(e.target.checked)} />
            Include a message in the email
          </label>
          {!bodyAllowed && (
            <span className="sx-help">
              {provider.emailBody === 'unsupported'
                ? `${provider.label} does not accept a message.`
                : `Off: ${provider.label} has not been verified to fax a message without adding pages. You can draft one; it is not sent.`}
            </span>
          )}
          <label className="sx-label" htmlFor="fax-body">
            Message {bodyAllowed ? '' : '(draft — not sent)'}
          </label>
          <textarea id="fax-body" className="sx-textarea" rows={4} maxLength={2000} value={body} disabled={provider.emailBody === 'unsupported'} onChange={(e) => setBody(e.target.value)} placeholder="Leave empty to send the attachment only (recommended)." aria-invalid={bodyProblem ? 'true' : undefined} aria-describedby={bodyProblem ? 'fax-body-error' : undefined} />
          {bodyProblem && (
            <span id="fax-body-error" className={styles.fieldError}>
              {bodyProblem}
            </span>
          )}
        </div>
        <div className={`sx-form-banner ${styles.caution}`}>{data.warning}</div>
      </section>

      {/* 4 ------------------------------------------------------------ */}
      <section className={styles.section} aria-labelledby="fax-cover">
        <h2 id="fax-cover" className="sx-section-title">
          Cover Page Options
        </h2>
        <label className={styles.check}>
          <input type="checkbox" checked={coverPage} disabled={!coverAllowed && !coverPage} onChange={(e) => setCoverPage(e.target.checked)} />
          Ask the provider to add a cover page
        </label>
        <p className="sx-help">
          {coverAllowed
            ? 'The provider adds its own cover page; it is one more fax page.'
            : `Not available: ${provider.label} has no verified cover page option. SOLIS never creates a cover page itself — each fax is the bundle PDF only.`}
        </p>
      </section>

      <div className={styles.saveRow}>
        <button
          type="button"
          className="sx-btn sx-btn-primary"
          disabled={!settingsDirty || busy !== null || subjectProblem !== null || bodyProblem !== null}
          onClick={() =>
            run(
              'settings',
              () => saveFaxSettings(organizationId, { expectedRevision: data.settings.revision, providerKey, subjectTemplate: subject, bodyEnabled, bodyTemplate: body, coverPageEnabled: coverPage }),
              'Fax Settings saved. They apply to bundles prepared from now on.',
            )
          }
        >
          {busy === 'settings' ? 'Saving…' : 'Save settings'}
        </button>
        {settingsDirty && <span className="sx-help">{subjectProblem || bodyProblem ? 'Fix the highlighted field to save.' : 'Unsaved changes'}</span>}
      </div>

      {/* 5 ------------------------------------------------------------ */}
      <section className={styles.section} aria-labelledby="fax-history">
        <h2 id="fax-history" className="sx-section-title">
          Fax Configuration History
        </h2>
        {history.isPending ? (
          <p>Loading…</p>
        ) : history.error ? (
          <p className={styles.warn}>{history.error.message}</p>
        ) : history.data!.length === 0 ? (
          <p className="sx-help">No changes yet. The built-in settings are in use.</p>
        ) : (
          <ol className={styles.history}>
            {history.data!.map((h) => (
              <li key={h.id}>
                <span>{h.description}</span>
                <span className="sx-help">
                  {formatTimestamp(h.at)} · {h.actor ?? 'Unknown'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {confirmArchive && (
        <Modal open onClose={() => setConfirmArchive(null)} title={`Archive ${confirmArchive.name}?`}>
          <div className={styles.confirm}>
            <h2 className={styles.confirmTitle}>Archive {confirmArchive.name}?</h2>
            <p className={styles.confirmNumber}>Fax {confirmArchive.faxNumberDisplay}</p>
            <ul className={styles.confirmList}>
              <li>Staff will no longer be able to choose it when sending a fax.</li>
              <li>A bundle already prepared for it will not send — staff will be asked to preview again with another destination.</li>
              <li>It stays in the history, and an administrator can restore it at any time.</li>
            </ul>
            <div className={styles.confirmActions}>
              <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setConfirmArchive(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="sx-btn sx-btn-primary"
                disabled={busy !== null}
                onClick={async () => {
                  const d = confirmArchive;
                  setConfirmArchive(null);
                  await run('archive', () => archiveFaxDestination(organizationId, d.id, d.revision ?? 0), `${d.name} archived. You can restore it from "Show archived".`);
                }}
              >
                Archive destination
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DestinationForm({
  form,
  setForm,
  isNew,
  busy,
  error,
  onCancel,
  onSave,
}: {
  form: { name: string; faxNumber: string; purpose: string; makeDefault: boolean };
  setForm: (f: { name: string; faxNumber: string; purpose: string; makeDefault: boolean }) => void;
  isNew: boolean;
  busy: boolean;
  /** The server's refusal of the last save, shown here rather than at the top of the page. */
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  // The server's own number check, so it never refuses what this form accepted.
  const numberHint = form.faxNumber.trim() ? problemOf(() => normalizeFaxNumber(form.faxNumber)) : null;
  const numberOk = form.faxNumber.trim() !== '' && numberHint === null;
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="sx-form-grid">
        <div className="sx-field">
          <label className="sx-label" htmlFor="fax-destination-name">
            Destination name
          </label>
          <input id="fax-destination-name" className="sx-input" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. County Vital Statistics" required />
        </div>
        <div className="sx-field">
          <label className="sx-label" htmlFor="fax-destination-number">
            Fax number
          </label>
          <input id="fax-destination-number" className="sx-input" inputMode="tel" autoComplete="off" value={form.faxNumber} aria-invalid={numberHint ? 'true' : undefined} aria-describedby={numberHint ? 'fax-destination-number-error' : undefined} onChange={(e) => setForm({ ...form, faxNumber: e.target.value })} placeholder="e.g. 941-555-0100" required />
          {numberHint && (
            <span id="fax-destination-number-error" className={styles.fieldError}>
              {numberHint}
            </span>
          )}
        </div>
        <div className="sx-field sx-span-all">
          <label className="sx-label" htmlFor="fax-destination-purpose">
            Purpose (optional)
          </label>
          <input id="fax-destination-purpose" className="sx-input" value={form.purpose} maxLength={100} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Death certificate applications" />
        </div>
        {isNew && (
          <label className={`${styles.check} sx-span-all`}>
            <input type="checkbox" checked={form.makeDefault} onChange={(e) => setForm({ ...form, makeDefault: e.target.checked })} />
            Make this the default destination
          </label>
        )}
      </div>
      {error && (
        <div className={`sx-form-banner sx-form-banner-error ${styles.formError}`} role="alert">
          <span>{error}</span>
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="sx-btn sx-btn-primary sx-btn-sm" disabled={busy || !form.name.trim() || !numberOk}>
          {busy ? 'Saving…' : isNew ? 'Add destination' : 'Save destination'}
        </button>
      </div>
    </form>
  );
}

/** The message a validator throws, or null when the value is fine. */
function problemOf(check: () => unknown): string | null {
  try {
    check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Not valid.';
  }
}
