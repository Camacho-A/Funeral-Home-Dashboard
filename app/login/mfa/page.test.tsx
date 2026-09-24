import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MfaChallengePage from './page';

function renderMfaChallengePage(searchParams: { next?: string; error?: string } = {}) {
  return MfaChallengePage({ searchParams: Promise.resolve(searchParams) });
}

describe('MfaChallengePage', () => {
  /** SOLIS branding (2026-09): the MFA challenge heading must read "SOLIS",
      never the retired "Beacon" branding or the lowercase-tail "Solis". */
  it('renders the SOLIS heading', async () => {
    render(await renderMfaChallengePage());
    expect(screen.getByRole('heading', { name: 'SOLIS' })).toBeInTheDocument();
    expect(screen.queryByText('Beacon')).not.toBeInTheDocument();
  });
});
