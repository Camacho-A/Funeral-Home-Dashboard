import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MfaChallengePage from './page';

function renderMfaChallengePage(searchParams: { next?: string; error?: string } = {}) {
  return MfaChallengePage({ searchParams: Promise.resolve(searchParams) });
}

describe('MfaChallengePage', () => {
  /** Solis rename (2026-09): the MFA challenge heading must read "Solis",
      never the retired "Beacon" branding. */
  it('renders the Solis heading', async () => {
    render(await renderMfaChallengePage());
    expect(screen.getByRole('heading', { name: 'Solis' })).toBeInTheDocument();
    expect(screen.queryByText('Beacon')).not.toBeInTheDocument();
  });
});
