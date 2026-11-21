'use client';

import { useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { issuePortalMfaSetupCode } from '@/lib/mfaClient';

/**
 * Portal-scoped MFA (Phase 5N follow-up). An administrator issues a one-time
 * setup code so a team member whose two-step verification was set up in
 * another SOLIS portal can set it up in this one. Shown once; give it to
 * them in person or by phone. Their other portal is not affected.
 */
export function PortalMfaSetupCodeDialog({ organizationId, member, onClose }: { organizationId: string; member: { identityId: string; displayName: string }; onClose: () => void }) {
  // Issued only on an explicit click, once — never automatically when the dialog opens.
  const [state, setState] = useState<{ code?: string; expiresAt?: string; error?: string; loading: boolean }>({ loading: false });
  const inFlight = useRef(false);
  async function issue() {
    if (inFlight.current || state.code) return;
    inFlight.current = true;
    setState({ loading: true });
    try {
      setState({ ...(await issuePortalMfaSetupCode(organizationId, member.identityId)), loading: false });
    } catch (e) {
      setState({ error: (e as Error).message, loading: false });
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <Modal open onClose={onClose} title="Two-step setup code">
      <div data-testid="portal-mfa-setup-code">
        {!state.code && (
          <>
            <p>
              Use this when <strong>{member.displayName}</strong> already has two-step verification in another SOLIS portal and needs to set it up here. Issuing a new code cancels any
              earlier one.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
              <button type="button" className="sx-btn sx-btn-primary" onClick={() => void issue()} disabled={state.loading} data-testid="issue-setup-code">
                {state.loading ? 'Issuing…' : 'Issue code'}
              </button>
            </div>
          </>
        )}
        {state.error && (
          <p role="alert" className="sx-form-banner sx-form-banner-error">
            {state.error}
          </p>
        )}
        {state.code && (
          <>
            <p>
              Give this one-time code to <strong>{member.displayName}</strong> in person or by phone. It works once, until{' '}
              {new Date(state.expiresAt!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. It will not be shown again.
            </p>
            <p style={{ fontSize: 24, fontWeight: 600, letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums', textAlign: 'center', margin: '16px 0' }} data-testid="portal-mfa-setup-code-value">
              {state.code}
            </p>
            <p style={{ fontSize: 13 }}>
              After signing in with their password and this code, they connect an authenticator app for this portal. Their two-step verification in the other portal keeps working.
            </p>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="sx-btn sx-btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
