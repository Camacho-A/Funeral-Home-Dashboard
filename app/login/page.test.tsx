import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoginPage from './page';

function renderLoginPage(searchParams: { next?: string; error?: string; notice?: string } = {}) {
  return LoginPage({ searchParams: Promise.resolve(searchParams) });
}

describe('LoginPage', () => {
  /** SOLIS branding (2026-09): the login screen heading is the primary
      wordmark a returning staff member sees — must read "SOLIS", never
      the retired "Beacon" branding or the lowercase-tail "Solis". */
  it('renders the SOLIS heading', async () => {
    render(await renderLoginPage());
    expect(screen.getByRole('heading', { name: 'SOLIS' })).toBeInTheDocument();
    expect(screen.queryByText('Beacon')).not.toBeInTheDocument();
  });
});
