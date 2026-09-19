'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useMfaStatus, useBeginMfa, useVerifyMfa, useDisableMfa, useRegenerateRecoveryCodes, useOrgMfaPolicy, useSetOrgMfaPolicy } from '@/hooks/useMfa';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

/**
 * Phase 40 (MFA & Account Security). Self-contained MFA management section for
 * the Security Settings page: enroll (authenticator secret + one-time recovery
 * codes), verify, regenerate recovery codes, and disable — plus, for
 * administrators, the organization require-MFA toggle. No QR library is added;
 * the authenticator secret + otpauth URI are shown for manual/scan entry.
 * Recovery codes and the secret live only in this browser session, never
 * persisted client-side.
 */
function RecoveryCodeList({ codes }: { codes: string[] }) {
  return (
    <div role="status" style={{ margin: '0.5rem 0', padding: '0.75rem', border: '1px solid #a3cfbb', background: '#d1e7dd', borderRadius: 6 }}>
      <strong>Save these recovery codes now.</strong> Each can be used once if you lose your authenticator. They will not be shown again.
      <ul style={{ columns: 2, fontFamily: 'monospace', margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

export function MfaPanel() {
  const { organizationId } = useOrganization();
  const status = useMfaStatus();
  const begin = useBeginMfa();
  const verify = useVerifyMfa();
  const disable = useDisableMfa();
  const regenerate = useRegenerateRecoveryCodes();

  const permissions = useMyPermissions(organizationId);
  const canManageOrg = (permissions.data?.permissions ?? []).includes('organization.manage');
  const orgPolicy = useOrgMfaPolicy(canManageOrg ? organizationId : '');
  const setPolicy = useSetOrgMfaPolicy(organizationId);

  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [enrollCode, setEnrollCode] = useState('');
  const [manageCode, setManageCode] = useState('');
  const [freshRecoveryCodes, setFreshRecoveryCodes] = useState<string[] | null>(null);

  const enabled = status.data?.mfaEnabled === true;

  async function startEnrollment() {
    setFreshRecoveryCodes(null);
    const res = await begin.mutateAsync();
    setEnrollment(res);
  }
  async function confirmEnrollment() {
    const codes = await verify.mutateAsync(enrollCode.trim());
    setEnrollment(null);
    setEnrollCode('');
    setFreshRecoveryCodes(codes);
  }
  async function doRegenerate() {
    const codes = await regenerate.mutateAsync(manageCode.trim());
    setManageCode('');
    setFreshRecoveryCodes(codes);
  }
  async function doDisable() {
    await disable.mutateAsync({ code: manageCode.trim() });
    setManageCode('');
    setFreshRecoveryCodes(null);
  }

  return (
    <section aria-labelledby="mfa-heading" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <h2 id="mfa-heading">Two-factor authentication</h2>
      {status.isPending && <p>Loading…</p>}

      {status.data && !enabled && !enrollment && (
        <>
          <p>Add a second step to your sign-in using an authenticator app (TOTP). Strongly recommended.</p>
          <div>
            <Button onClick={startEnrollment} disabled={begin.isPending}>{begin.isPending ? 'Preparing…' : 'Enable two-factor authentication'}</Button>
            {begin.isError && <span style={{ color: '#a00', marginLeft: '0.5rem' }}>{(begin.error as Error).message}</span>}
          </div>
        </>
      )}

      {enrollment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p>In your authenticator app, add a new account using this setup key:</p>
          <code style={{ fontFamily: 'monospace', wordBreak: 'break-all', padding: '0.4rem', background: '#f2f2f2', borderRadius: 4 }}>{enrollment.secret}</code>
          <details>
            <summary>Or use the setup URI</summary>
            <code style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.8em' }}>{enrollment.otpauthUri}</code>
          </details>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Enter the 6-digit code from your app
            <TextField value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          </label>
          <div>
            <Button onClick={confirmEnrollment} disabled={verify.isPending || enrollCode.trim().length === 0}>{verify.isPending ? 'Verifying…' : 'Verify & enable'}</Button>
            <Button variant="secondary" onClick={() => { setEnrollment(null); setEnrollCode(''); }} style={{ marginLeft: '0.5rem' }}>Cancel</Button>
            {verify.isError && <span style={{ color: '#a00', marginLeft: '0.5rem' }}>{(verify.error as Error).message}</span>}
          </div>
        </div>
      )}

      {freshRecoveryCodes && <RecoveryCodeList codes={freshRecoveryCodes} />}

      {status.data && enabled && !enrollment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p>
            Two-factor authentication is <strong>on</strong>. {status.data.remainingRecoveryCodes} recovery code{status.data.remainingRecoveryCodes === 1 ? '' : 's'} remaining.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Authentication code (to manage MFA)
            <TextField value={manageCode} onChange={(e) => setManageCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={doRegenerate} disabled={regenerate.isPending || manageCode.trim().length === 0}>Regenerate recovery codes</Button>
            <Button variant="secondary" onClick={doDisable} disabled={disable.isPending || manageCode.trim().length === 0}>Turn off two-factor authentication</Button>
          </div>
          {(regenerate.isError || disable.isError) && <span style={{ color: '#a00' }}>{((regenerate.error || disable.error) as Error)?.message}</span>}
        </div>
      )}

      {canManageOrg && (
        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #ddd' }}>
          <h3 style={{ marginBottom: '0.25rem' }}>Organization policy</h3>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={orgPolicy.data === true}
              disabled={orgPolicy.isPending || setPolicy.isPending}
              onChange={(e) => setPolicy.mutate(e.target.checked)}
            />
            Require two-factor authentication for all staff in this organization
          </label>
          <p style={{ fontSize: '0.8rem', color: '#666', margin: '0.25rem 0 0' }}>
            Members who aren&rsquo;t enrolled are guided to set it up at sign-in — they are never locked out.
          </p>
        </div>
      )}
    </section>
  );
}
