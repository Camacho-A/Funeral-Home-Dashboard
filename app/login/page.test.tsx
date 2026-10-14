import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoginPage from './page';
import type { LoginLogo } from './branding';

/** The organization logo the page should render, swapped per test.
    `null` — the default — is mock mode's own real answer, since the mock
    fixtures hold two active organizations and the deployment therefore
    cannot resolve one (domain/organization/loginBranding.ts). */
let loginLogo: LoginLogo | null = null;
vi.mock('./branding', () => ({ loadLoginLogo: async () => loginLogo }));

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

  /**
   * Organization logo (2026-10). Staff sign in to THEIR funeral home, so
   * its logo appears above the lockup — without SOLIS losing its place.
   */
  describe('organization logo', () => {
    afterEach(() => {
      loginLogo = null;
    });

    it('renders the organization logo above the SOLIS lockup', async () => {
      loginLogo = { url: 'https://blob.example.com/logo.png', organizationName: 'MANORS CREMATION' };
      render(await renderLoginPage());

      const logo = screen.getByAltText('MANORS CREMATION');
      expect(logo).toHaveAttribute('src', 'https://blob.example.com/logo.png');

      // Order matters: the funeral home's own mark reads first.
      const heading = screen.getByRole('heading', { name: 'SOLIS' });
      expect(logo.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps SOLIS — the logo is added beside it, never in place of it', async () => {
      loginLogo = { url: 'https://blob.example.com/logo.png', organizationName: 'MANORS CREMATION' };
      render(await renderLoginPage());

      expect(screen.getByRole('heading', { name: 'SOLIS' })).toBeInTheDocument();
      expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute('src', '/brand/soliscode-mark.png');
    });

    it('does not become the page heading — SOLIS is still the only one', async () => {
      loginLogo = { url: 'https://blob.example.com/logo.png', organizationName: 'MANORS CREMATION' };
      render(await renderLoginPage());

      const headings = screen.getAllByRole('heading');
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveAccessibleName('SOLIS');
    });

    it('renders the card exactly as before when no logo resolves', async () => {
      loginLogo = null;
      render(await renderLoginPage());

      expect(screen.getByRole('heading', { name: 'SOLIS' })).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      // Only the decorative SOLIS mark — no second, unexplained image.
      expect(document.querySelectorAll('img')).toHaveLength(1);
    });

    it('still signs people in when branding is unavailable', async () => {
      // loadLoginLogo swallows its own failures (./branding.ts); this pins
      // that a null result never costs the form.
      loginLogo = null;
      render(await renderLoginPage({ error: 'invalid_credentials' }));

      expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });
});