import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoginPage from './page';

function renderLoginPage(searchParams: { next?: string; error?: string; notice?: string } = {}) {
  return LoginPage({ searchParams: Promise.resolve(searchParams) });
}

describe('LoginPage', () => {
  /** Solis rename (2026-09): the login screen heading is the primary
      wordmark a returning staff member sees — must read "Solis", never
      the retired "Beacon" branding. */
  it('renders the Solis heading', async () => {
    render(await renderLoginPage());
    expect(screen.getByRole('heading', { name: 'Solis' })).toBeInTheDocument();
    expect(screen.queryByText('Beacon')).not.toBeInTheDocument();
  });
});
