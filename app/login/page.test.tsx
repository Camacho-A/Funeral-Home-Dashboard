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

  /** Task #13 (2026-09, SOLIS product branding). Login now renders the
      same [SolisCode mark] SOLIS lockup (ProductBrand) the Sidebar uses,
      inside the same <h1> as before — never a redesign of the form/page
      itself. */
  describe('SOLIS product branding (Task #13, 2026-09)', () => {
    it('4/5: renders the real SolisCode mark asset, and SOLIS remains the heading\'s accessible (real-text) name', async () => {
      render(await renderLoginPage());
      const heading = screen.getByRole('heading', { name: 'SOLIS' });
      const mark = screen.getByRole('presentation', { hidden: true });
      expect(mark).toHaveAttribute('src', '/brand/soliscode-mark.png');
      expect(heading).toHaveTextContent('SOLIS');
    });

    it('7: the mark is decorative (alt="", aria-hidden) — never announced redundantly alongside the SOLIS heading', async () => {
      render(await renderLoginPage());
      const mark = screen.getByRole('presentation', { hidden: true });
      expect(mark).toHaveAttribute('alt', '');
      expect(mark).toHaveAttribute('aria-hidden', 'true');
    });

    it('10: form fields, validation, and error/notice messaging remain unaffected by the branding change', async () => {
      render(await renderLoginPage({ error: 'invalid_credentials' }));
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
    });
  });

  /** Task #13 final visual adjustment (2026-09): the Sidebar moved to
      ProductBrand's `vertical` variant (larger mark stacked above
      centered "SOLIS"); Login explicitly keeps its original horizontal
      [mark] SOLIS lockup, unchanged. */
  describe('Login retains its original horizontal lockup (Task #13 final visual adjustment, 2026-09)', () => {
    it('4: does not use the vertical variant\'s wrapper class — the horizontal side-by-side lockup is unchanged', async () => {
      render(await renderLoginPage());
      const mark = screen.getByRole('presentation', { hidden: true });
      expect(mark.parentElement?.className).not.toMatch(/vertical/);
    });

    it('4: the mark size is unchanged from the original horizontal implementation (40px)', async () => {
      render(await renderLoginPage());
      const mark = screen.getByRole('presentation', { hidden: true });
      expect(mark).toHaveAttribute('width', '40');
      expect(mark).toHaveAttribute('height', '40');
    });
  });
});
