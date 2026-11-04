'use client';

import { useState } from 'react';
import { beginMfa, verifyMfa } from '@/lib/mfaClient';
import { TextField } from '@/components/ui/TextField';

/**
 * MFA enrollment gate (2026-11). The required-enrollment step: get a setup
 * key, prove it with a code, save the recovery codes, continue. Interrupted
 * part-way (closed tab, wrong code), staff simply start again — a new setup
 * key replaces the unverified one, and MFA is only on after a code verifies.
 * Secrets and recovery codes live only in this component's state.
 */
export function MfaEnrollmentSetup({ next }: { next: string }) {
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div>
        <div role="status" className="sx-form-banner sx-form-banner-info" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <strong>Two-factor authentication is on. Save these recovery codes now.</strong> Each can be used once if you lose your authenticator. They will not be
          shown again.
          <ul style={{ columns: 2, fontFamily: 'monospace', margin: '8px 0 0', paddingLeft: 20 }}>
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <button type="button" className="sx-btn sx-btn-primary" style={{ marginTop: 12 }} onClick={() => window.location.assign(next)}>
          I saved my recovery codes — continue
        </button>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {error}
        </div>
      )}
      {!enrollment ? (
        <button type="button" className="sx-btn sx-btn-primary" disabled={busy} onClick={() => run(async () => setEnrollment(await beginMfa()))}>
          {busy ? 'Preparing…' : 'Set up two-factor authentication'}
        </button>
      ) : (
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
            <label className="sx-label" htmlFor="mfa-setup-code">
              Enter the 6-digit code from your app
            </label>
            <TextField className="sx-input" id="mfa-setup-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          </div>
          <div className="sx-span-all" style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="sx-btn sx-btn-primary"
              disabled={busy || code.trim().length === 0}
              onClick={() => run(async () => setRecoveryCodes(await verifyMfa(code.trim())))}
            >
              {busy ? 'Verifying…' : 'Verify & turn on'}
            </button>
            <button type="button" className="sx-btn sx-btn-secondary" disabled={busy} onClick={() => run(async () => (setCode(''), setEnrollment(await beginMfa())))}>
              Start over with a new key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
