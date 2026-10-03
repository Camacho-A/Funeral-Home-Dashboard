'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useMfaStatus, useBeginMfa, useVerifyMfa, useDisableMfa, useRegenerateRecoveryCodes, useOrgMfaPolicy, useSetOrgMfaPolicy } from '@/hooks/useMfa';
import { TextField } from '@/components/ui/TextField';

/**
 * Phase 40 (MFA & Account Security). Self-contained MFA management section for
 * the Security Settings page: enroll (authenticator secret + one-time recovery
 * codes), verify, regenerate recovery codes, and disable — plus, for
 * administrators, the organization require-MFA toggle. No QR library is added;
 * the authenticator secret + otpauth URI are shown for manual/scan entry.
 * Recovery codes and the secret live only in this browser session, never
 * persisted client-side.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S4): its own
 * `.sx-settings-section` (rendered by the caller). Enrollment content
 * uses the form system; "Regenerate recovery codes" → `sx-btn-secondary`,
 * "Turn off two-factor authentication" → `sx-btn-danger`, "Organization
 * policy" → `.sx-perm-group-title`. No MFA/session logic changed.
 */
function RecoveryCodeList({ codes }: { codes: string[] }) {
  return (
    <div role="status" className="sx-form-banner sx-form-banner-info" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
      <strong>Save these recovery codes now.</strong> Each can be used once if you lose your authenticator. They will not be shown again.
      <ul style={{ columns: 2, fontFamily: 'monospace', margin: '8px 0 0', paddingLeft: 20 }}>
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
    <div>
      <div className="sx-settings-section-head">
        <div>
          <h3 className="sx-settings-section-title" id="mfa-heading">
            Two-factor authentication
          </h3>
        </div>
      </div>
      {status.isPending && (
        <div className="sx-loading" aria-busy="true">
          <span className="sx-skeleton" style={{ width: '70%' }} />
          <span className="sr-only">Loading…</span>
        </div>
      )}

      {status.data && !enabled && !enrollment && (
        <>
          <p className="sx-help" style={{ marginBottom: 10 }}>
            Add a second step to your sign-in using an authenticator app (TOTP). Strongly recommended.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="sx-btn sx-btn-primary" onClick={startEnrollment} disabled={begin.isPending}>
              {begin.isPending ? 'Preparing…' : 'Enable two-factor authentication'}
            </button>
            {begin.isError && (
              <span className="sx-error" role="alert">
                {(begin.error as Error).message}
              </span>
            )}
          </div>
        </>
      )}

      {enrollment && (
        <div className="sx-form-grid">
          <p className="sx-span-all" style={{ margin: 0 }}>
            In your authenticator app, add a new account using this setup key:
          </p>
          <code className="sx-span-all" style={{ fontFamily: 'monospace', wordBreak: 'break-all', padding: 8, background: 'var(--sx-subtle)', borderRadius: 7 }}>
            {enrollment.secret}
          </code>
          <details className="sx-span-all">
            <summary>Or use the setup URI</summary>
            <code style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.8em' }}>{enrollment.otpauthUri}</code>
          </details>
          <div className="sx-field sx-span-all">
            <label className="sx-label" htmlFor="mfa-enroll-code">
              Enter the 6-digit code from your app
            </label>
            <TextField className="sx-input" id="mfa-enroll-code" value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          </div>
          <div className="sx-span-all" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="sx-btn sx-btn-primary" onClick={confirmEnrollment} disabled={verify.isPending || enrollCode.trim().length === 0}>
              {verify.isPending ? 'Verifying…' : 'Verify & enable'}
            </button>
            <button
              type="button"
              className="sx-btn sx-btn-secondary"
              onClick={() => {
                setEnrollment(null);
                setEnrollCode('');
              }}
            >
              Cancel
            </button>
            {verify.isError && (
              <span className="sx-error" role="alert">
                {(verify.error as Error).message}
              </span>
            )}
          </div>
        </div>
      )}

      {freshRecoveryCodes && <RecoveryCodeList codes={freshRecoveryCodes} />}

      {status.data && enabled && !enrollment && (
        <div className="sx-form-grid">
          <p className="sx-span-all" style={{ margin: 0 }}>
            Two-factor authentication is <strong>on</strong>. {status.data.remainingRecoveryCodes} recovery code{status.data.remainingRecoveryCodes === 1 ? '' : 's'} remaining.
          </p>
          <div className="sx-field sx-span-all">
            <label className="sx-label" htmlFor="mfa-manage-code">
              Authentication code (to manage MFA)
            </label>
            <TextField className="sx-input" id="mfa-manage-code" value={manageCode} onChange={(e) => setManageCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          </div>
          <div className="sx-span-all" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="sx-btn sx-btn-secondary" onClick={doRegenerate} disabled={regenerate.isPending || manageCode.trim().length === 0}>
              Regenerate recovery codes
            </button>
            <button type="button" className="sx-btn sx-btn-danger" onClick={doDisable} disabled={disable.isPending || manageCode.trim().length === 0}>
              Turn off two-factor authentication
            </button>
          </div>
          {(regenerate.isError || disable.isError) && (
            <span className="sx-error sx-span-all" role="alert">
              {((regenerate.error || disable.error) as Error)?.message}
            </span>
          )}
        </div>
      )}

      {canManageOrg && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--sx-border)' }}>
          <div className="sx-perm-group-title">Organization policy</div>
          <label className="sx-check">
            <input type="checkbox" checked={orgPolicy.data === true} disabled={orgPolicy.isPending || setPolicy.isPending} onChange={(e) => setPolicy.mutate(e.target.checked)} />
            Require two-factor authentication for all staff in this organization
          </label>
          <p className="sx-help" style={{ marginTop: 4 }}>
            Members who aren&rsquo;t enrolled are guided to set it up at sign-in — they are never locked out.
          </p>
        </div>
      )}
    </div>
  );
}
