import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Regression (found in the browser): a setup code must be issued only on an explicit click, exactly once — never when the dialog opens (React runs mount effects twice in development, and two racing issues revoked the shown code). */
const issue = vi.hoisted(() => vi.fn(async () => ({ code: 'ABCD-EFGH-JKLM', expiresAt: '2026-11-20T12:30:00.000Z' })));
vi.mock('@/lib/mfaClient', () => ({ issuePortalMfaSetupCode: issue }));
const { PortalMfaSetupCodeDialog } = await import('./PortalMfaSetupCodeDialog');

describe('two-step setup code dialog', () => {
  it('issues nothing on open; one request on click, even when clicked twice', async () => {
    render(
      <StrictMode>
        <PortalMfaSetupCodeDialog organizationId="gus-camacho-jr" member={{ identityId: 'identity-dual-sam', displayName: 'Sam Transition' }} onClose={() => undefined} />
      </StrictMode>,
    );
    expect(issue).not.toHaveBeenCalled();
    const button = screen.getByTestId('issue-setup-code');
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('portal-mfa-setup-code-value').textContent).toBe('ABCD-EFGH-JKLM'));
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledWith('gus-camacho-jr', 'identity-dual-sam');
  });
});
