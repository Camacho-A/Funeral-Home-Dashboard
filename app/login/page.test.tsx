import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoginPage from './page';
import type { LoginOrganization } from './branding';

/** The organization the page is branded for, swapped per test. `null` —
    the default — is the generic SOLIS login: no hostname mapping and no
    single-tenant configuration (domain/organization/loginBranding.ts). */
let loginOrganization: LoginOrganization | null = null;
vi.mock('./branding', () => ({ loadLoginOrganization: async () => loginOrganization }));

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
  /**
   * Login page branding refinement (2026-10). SOLIS leads; the
   * organization identifies the workspace below it.
   */
  describe('organization branding', () => {
    afterEach(() => {
      loginOrganization = null;
    });

    it('puts SOLIS first and the organization below it', async () => {
      loginOrganization = { name: 'Manors Cremation', logoUrl: 'https://blob.example.com/logo.png' };
      const { container } = render(await renderLoginPage());

      const heading = screen.getByRole('heading', { name: 'SOLIS' });
      const workspace = screen.getByText('Manors Cremation Workspace');
      // SOLIS is the primary identity: it must come first in the document.
      expect(heading.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.querySelector('img[src="https://blob.example.com/logo.png"]')).toBeTruthy();
    });

    it("renders SOLIS's own tagline under the lockup", async () => {
      render(await renderLoginPage());
      expect(screen.getByText('Built with Balance.')).toBeInTheDocument();
    });

    it('names the workspace rather than repeating the organization in two voices', async () => {
      loginOrganization = { name: 'Manors Cremation', logoUrl: 'https://blob.example.com/logo.png' };
      const { container } = render(await renderLoginPage());

      expect(screen.getByText('Manors Cremation Workspace')).toBeInTheDocument();
      // The logo is decorative: the workspace line already carries the
      // name as real text, so a screen reader must not hear it twice.
      const logo = container.querySelector('img[src="https://blob.example.com/logo.png"]');
      expect(logo).toHaveAttribute('alt', '');
      expect(screen.queryByAltText('Manors Cremation')).not.toBeInTheDocument();
    });

    it('identifies the workspace even when no logo is configured', async () => {
      loginOrganization = { name: 'Gus Camacho Jr. Funeral Home', logoUrl: null };
      const { container } = render(await renderLoginPage());

      expect(screen.getByText('Gus Camacho Jr. Funeral Home Workspace')).toBeInTheDocument();
      // Only the decorative SOLIS mark — no broken organization image.
      expect(container.querySelectorAll('img')).toHaveLength(1);
    });

    it('shows SOLIS branding only on a generic login — never a default tenant', async () => {
      loginOrganization = null;
      const { container } = render(await renderLoginPage());

      expect(screen.getByRole('heading', { name: 'SOLIS' })).toBeInTheDocument();
      expect(screen.getByText('Built with Balance.')).toBeInTheDocument();
      expect(screen.queryByText(/Workspace$/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Manors/i)).not.toBeInTheDocument();
      expect(container.querySelectorAll('img')).toHaveLength(1);
    });

    it('closes the card with an understated "Powered by SOLIS"', async () => {
      render(await renderLoginPage());
      const poweredBy = screen.getByText('Powered by SOLIS');
      expect(poweredBy).toBeInTheDocument();
      // Last thing on the card, so it cannot compete with the lockup.
      const heading = screen.getByRole('heading', { name: 'SOLIS' });
      expect(heading.compareDocumentPosition(poweredBy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('leaves the sign-in form, its messaging, and password reset untouched', async () => {
      loginOrganization = { name: 'Manors Cremation', logoUrl: 'https://blob.example.com/logo.png' };
      render(await renderLoginPage({ error: 'invalid_credentials' }));

      expect(screen.getByText('Sign in to continue.')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
      expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
    });

    it('still signs people in when branding is unavailable', async () => {
      // loadLoginOrganization swallows its own failures (./branding.ts);
      // this pins that a null result never costs the form.
      loginOrganization = null;
      render(await renderLoginPage({ error: 'invalid_credentials' }));

      expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });
});
