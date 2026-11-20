'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { CREDENTIAL_ACTION_LABEL, LICENSE_STATUSES, LICENSE_TYPES, VERIFICATION_METHODS, type CredentialChange } from '@/domain/staff/funeralDirectorCredentials';
import type { StaffCredentialSummary } from '@/services/funeralDirectorCredentialService';
import styles from './FuneralDirectorCredentialsPanel.module.css';

/**
 * Settings › Funeral Director Credentials (Gus Phase 5G, 2026-11). An
 * administrator enters a staff member's license, verifies it against the
 * state record, and grants or removes Funeral Director authorization for
 * someone whose role is not Funeral Director. Nobody can change their own
 * row. Every change is kept in that person's history (and in Activity).
 * Nothing here permits release for cremation by itself.
 */
const key = (organizationId: string) => ['funeralDirectorCredentials', organizationId];
const when = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

type Mode = null | 'license' | 'verify' | 'revoke';

function Row({ staff, isSelf, onChange, saving }: { staff: StaffCredentialSummary; isSelf: boolean; onChange: (change: CredentialChange) => Promise<void>; saving: boolean }) {
  const record = staff.record;
  const license = record?.license ?? null;
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState({ licenseNumber: license?.licenseNumber ?? '', state: license?.state ?? 'FL', licenseType: license?.licenseType ?? 'funeral_director', status: license?.status ?? 'active', expiresOn: license?.expiresOn ?? '' });
  const [verify, setVerify] = useState({ method: 'state_license_lookup', reference: '' });
  const [reason, setReason] = useState('');
  const submit = (change: CredentialChange) => onChange(change).then(() => setMode(null));

  return (
    <li className={styles.row} data-testid={`credential-${staff.staffProfileId}`}>
      <div className={styles.head}>
        <strong>{staff.displayName}</strong>
        {staff.licenseCheck.verified ? <Badge variant="success">License verified</Badge> : <Badge variant={license ? 'warning' : 'neutral'}>{license ? 'Not verified' : 'No license on file'}</Badge>}
        {record?.authorization && <Badge variant="brand">Authorized as Funeral Director</Badge>}
      </div>
      {license && (
        <p className={styles.line}>
          {license.state} {LICENSE_TYPES.find((t) => t.value === license.licenseType)?.label ?? license.licenseType} · No. {license.licenseNumber} · {license.status} · expires {license.expiresOn}
          {license.verification && (
            <span className={styles.muted}>
              Verified {when(license.verification.verifiedAt)} by {license.verification.verifiedByName ?? 'an administrator'} ({VERIFICATION_METHODS.find((m) => m.value === license.verification!.method)?.label}: {license.verification.reference})
            </span>
          )}
        </p>
      )}
      {!staff.licenseCheck.verified && license && <p className={styles.muted}>{staff.licenseCheck.problems.join(' ')}</p>}
      {staff.licenseCheck.notes.length > 0 && <p className={styles.muted}>{staff.licenseCheck.notes.join(' ')}</p>}
      {record?.authorization && (
        <p className={styles.muted}>
          Authorized {when(record.authorization.authorizedAt)} by {record.authorization.authorizedByName ?? 'an administrator'}
        </p>
      )}

      {isSelf ? (
        <p className={styles.muted}>This is you. Someone else who manages credentials must enter, verify or authorize yours.</p>
      ) : (
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={saving} onClick={() => setMode(mode === 'license' ? null : 'license')}>
            {license ? 'Edit license' : 'Enter license'}
          </button>
          {license && (
            <button type="button" className={styles.button} disabled={saving} onClick={() => setMode(mode === 'verify' ? null : 'verify')}>
              Verify license
            </button>
          )}
          {record?.authorization ? (
            <button type="button" className={styles.button} disabled={saving} onClick={() => setMode(mode === 'revoke' ? null : 'revoke')}>
              Remove authorization
            </button>
          ) : (
            <button type="button" className={styles.button} disabled={saving} onClick={() => submit({ kind: 'grant_authorization' })}>
              Authorize as Funeral Director
            </button>
          )}
        </div>
      )}

      {mode === 'license' && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            submit({ kind: 'set_license', ...form, status: form.status as never });
          }}
        >
          <label>
            License number
            <TextField value={form.licenseNumber} maxLength={50} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} required />
          </label>
          <label>
            State
            <TextField value={form.state} maxLength={2} onChange={(e) => setForm({ ...form, state: e.target.value })} required />
          </label>
          <label>
            License type
            <SelectField value={form.licenseType} onChange={(e) => setForm({ ...form, licenseType: e.target.value })}>
              {LICENSE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label>
            Status
            <SelectField value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}>
              {LICENSE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
          </label>
          <label>
            Expires
            <TextField type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} required />
          </label>
          <p className={styles.muted}>Saving new or changed details clears the verification; verify the license again afterwards.</p>
          <button type="submit" className={styles.button} disabled={saving}>
            Save license
          </button>
        </form>
      )}
      {mode === 'verify' && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            submit({ kind: 'verify_license', method: verify.method as 'state_license_lookup' | 'license_document', reference: verify.reference });
          }}
        >
          <label>
            How it was verified
            <SelectField value={verify.method} onChange={(e) => setVerify({ ...verify, method: e.target.value })}>
              {VERIFICATION_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label>
            Where (lookup page, document)
            <TextField value={verify.reference} maxLength={200} onChange={(e) => setVerify({ ...verify, reference: e.target.value })} required />
          </label>
          <button type="submit" className={styles.button} disabled={saving}>
            Record verification
          </button>
        </form>
      )}
      {mode === 'revoke' && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            submit({ kind: 'revoke_authorization', reason });
          }}
        >
          <label>
            Reason
            <TextField value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} required />
          </label>
          <button type="submit" className={styles.button} disabled={saving}>
            Remove authorization
          </button>
        </form>
      )}

      {(record?.history.length ?? 0) > 0 && (
        <details className={styles.history}>
          <summary>History ({record!.history.length})</summary>
          <ol>
            {[...record!.history].reverse().map((entry) => (
              <li key={entry.eventId}>
                {CREDENTIAL_ACTION_LABEL[entry.action]}
                {entry.reason ? ` — ${entry.reason}` : ''} · {entry.actorName ?? 'an administrator'}, {when(entry.at)}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

export function FuneralDirectorCredentialsPanel() {
  const { organizationId } = useOrganization();
  const me = useMyPermissions(organizationId);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: key(organizationId),
    queryFn: async () => {
      const response = await fetch(`/api/settings/funeral-director-credentials?${new URLSearchParams({ organizationId })}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Could not load credentials.');
      return body.staff as StaffCredentialSummary[];
    },
    enabled: Boolean(organizationId),
  });
  const change = useMutation({
    mutationFn: async (input: { staffProfileId: string; expectedRevision: number; change: CredentialChange }) => {
      const response = await fetch('/api/settings/funeral-director-credentials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId, ...input }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Could not save.');
      return body;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key(organizationId) }),
  });

  if (query.isPending) return <p aria-busy="true">Loading…</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  return (
    <section className={styles.panel}>
      <p className={styles.intro}>
        Only a staff member who is a Funeral Director (by role, or authorized here) <strong>and</strong> holds a verified license can ever approve release for cremation — and release
        has its own requirements on every case. Being an administrator never permits it.
      </p>
      {change.isError && (
        <p className="sx-form-banner sx-form-banner-error" role="alert">
          {change.error.message}
        </p>
      )}
      <ul className={styles.list}>
        {query.data.map((staff) => (
          <Row
            key={staff.staffProfileId}
            staff={staff}
            isSelf={me.data?.identityId === staff.identityId}
            saving={change.isPending}
            onChange={(c) => change.mutateAsync({ staffProfileId: staff.staffProfileId, expectedRevision: staff.record?.revision ?? 0, change: c }).then(() => undefined)}
          />
        ))}
      </ul>
    </section>
  );
}
