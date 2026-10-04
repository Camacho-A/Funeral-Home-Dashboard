import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { organizationsService } from '@/services/organizationsService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

// Addendum 2, item #6 (2026-10): a mutable vi.fn (not a plain arrow
// function) so the new "Settings expanded" describe block below can
// override the pathname per test — every pre-existing test in this file
// relies on the '/dashboard' default and never touches this itself.
vi.mock('next/navigation', () => ({ usePathname: vi.fn(() => '/dashboard') }));

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn(), fetchActiveStaffCount: vi.fn(), fetchActiveStaffList: vi.fn().mockResolvedValue([]) };
});

vi.spyOn(organizationsService, 'get').mockResolvedValue({
  id: DEFAULT_ORGANIZATION_ID,
  name: 'Manors Cremation',
  isActive: true,
});

vi.spyOn(organizationsService, 'getBranding').mockResolvedValue(null);

function mockPermissions(permissions: string[] = []) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

function renderSidebar(
  authAdapterMode?: 'mock' | 'wix' | 'identity',
  drawerProps: { mobileOpen?: boolean; onClose?: () => void } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <Sidebar authAdapterMode={authAdapterMode} {...drawerProps} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('Sidebar "N staff online"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the real fetched count, not a hardcoded value, for the current organization', async () => {
    mockPermissions();
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(5);
    renderSidebar('identity');
    expect(await screen.findByText('5 staff online')).toBeInTheDocument();
    expect(identityAuthClient.fetchActiveStaffCount).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID);
  });

  it('renders "0 staff online" for zero active staff', async () => {
    mockPermissions();
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(0);
    renderSidebar('identity');
    expect(await screen.findByText('0 staff online')).toBeInTheDocument();
  });

  it('renders "1 staff online" for one active staff member', async () => {
    mockPermissions();
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(1);
    renderSidebar('identity');
    expect(await screen.findByText('1 staff online')).toBeInTheDocument();
  });

  it('renders "2 staff online" for multiple active staff', async () => {
    mockPermissions();
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(2);
    renderSidebar('identity');
    expect(await screen.findByText('2 staff online')).toBeInTheDocument();
  });

  it('does not fetch or render any staff-online count outside identity mode', async () => {
    mockPermissions();
    renderSidebar('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(identityAuthClient.fetchActiveStaffCount).not.toHaveBeenCalled();
    expect(screen.queryByText(/staff online/)).not.toBeInTheDocument();
  });

  it('does not fetch or render any staff-online count when authAdapterMode is omitted', async () => {
    mockPermissions();
    renderSidebar(undefined);
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(identityAuthClient.fetchActiveStaffCount).not.toHaveBeenCalled();
    expect(screen.queryByText(/staff online/)).not.toBeInTheDocument();
  });
});

describe('Sidebar — Settings visibility (item #5, 2026-09 navigation cleanup)', () => {
  it('1: shows Settings for an identity-mode session (Security is always available there)', async () => {
    mockPermissions([]);
    renderSidebar('identity');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(await screen.findByText('Settings')).toBeInTheDocument();
  });

  it('shows Settings in mock mode for a caller holding caseNumber.manage', async () => {
    mockPermissions(['caseNumber.manage']);
    renderSidebar('mock');
    expect(await screen.findByText('Settings')).toBeInTheDocument();
  });

  it('shows Settings in mock mode for a caller holding case.create (Import Existing Jotform)', async () => {
    mockPermissions(['case.create']);
    renderSidebar('mock');
    expect(await screen.findByText('Settings')).toBeInTheDocument();
  });

  it('shows Settings in mock mode for a caller holding user.manageRoles', async () => {
    mockPermissions(['user.manageRoles']);
    renderSidebar('mock');
    expect(await screen.findByText('Settings')).toBeInTheDocument();
  });

  it('8: hides Settings for a mock-mode caller with none of the relevant permissions — never an empty destination', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('hides Settings when authAdapterMode is omitted and the caller has none of the relevant permissions', async () => {
    mockPermissions([]);
    renderSidebar(undefined);
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
});

describe('Sidebar — SOLIS product branding (Task #13, 2026-09)', () => {
  it('1/2: renders the real SolisCode mark asset alongside the SOLIS wordmark as real text', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('src', '/brand/soliscode-mark.png');
    expect(screen.getByText('SOLIS')).toBeInTheDocument();
  });

  it('3: the old CSS-only placeholder square is gone — no element with the removed brandMark class', async () => {
    mockPermissions([]);
    const { container } = renderSidebar('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(container.querySelector('[class*="brandMark"]')).toBeNull();
  });

  it('9: the mark is decorative — alt="" and aria-hidden, so it never duplicates the accessible "SOLIS" text', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('alt', '');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('6: the active organization name (Manors Cremation) remains its own, separate identity from the SOLIS product mark', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    expect(await screen.findByText('Manors Cremation')).toBeInTheDocument();
    expect(screen.getByText('SOLIS')).toBeInTheDocument();
  });

  it('7: Sidebar navigation remains functional alongside the new branding', async () => {
    mockPermissions(['case.create']);
    renderSidebar('mock');
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });
});

describe('Sidebar — compact horizontal brand row (SOLIS true redesign, Phase 1, 2026-10)', () => {
  it('1: uses ProductBrand\'s default horizontal variant — a compact [mark] SOLIS row, replacing the prior stacked-vertical lockup', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark.parentElement?.className).not.toMatch(/vertical/);
  });

  it('2: still uses the exact same /brand/soliscode-mark.png asset — only size/layout changed, never the artwork', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('src', '/brand/soliscode-mark.png');
  });
});

describe('Sidebar — compact SOLIS brand lockup sizing (SOLIS true redesign, Phase 1, 2026-10)', () => {
  it('1: the mark renders at 26px — the approved design\'s own compact sizing, replacing the prior 96px stacked lockup', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('width', '26');
    expect(mark).toHaveAttribute('height', '26');
  });

  it('2: the SOLIS wordmark uses the Sidebar\'s own brandWordmark styling', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const wordmark = await screen.findByText('SOLIS');
    expect(wordmark.className).toMatch(/brandWordmark/);
  });

  it('5: still the same /brand/soliscode-mark.png asset', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('src', '/brand/soliscode-mark.png');
  });

  it('6: SOLIS remains real, visible text', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    expect(await screen.findByText('SOLIS')).toBeInTheDocument();
  });

  it('7: accessibility treatment is unchanged — decorative mark, no redundant announcement', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('alt', '');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('8: Sidebar navigation remains unaffected by the larger lockup', async () => {
    mockPermissions(['case.create']);
    renderSidebar('mock');
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });
});

describe('Sidebar — mobile navigation drawer (2026-09)', () => {
  it('defaults to closed (no sidebarOpen class) when mobileOpen is omitted — desktop\'s unchanged default', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).not.toMatch(/sidebarOpen/);
  });

  it('applies the open class when mobileOpen is true', async () => {
    mockPermissions([]);
    renderSidebar('mock', { mobileOpen: true });
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).toMatch(/sidebarOpen/);
  });

  it('renders a close button that calls onClose when clicked', async () => {
    mockPermissions([]);
    const onClose = vi.fn();
    renderSidebar('mock', { mobileOpen: true, onClose });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close navigation menu' })).toBeInTheDocument());
    screen.getByRole('button', { name: 'Close navigation menu' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when a nav link is clicked, so the drawer closes on navigation', async () => {
    mockPermissions(['case.create']);
    const onClose = vi.fn();
    renderSidebar('mock', { mobileOpen: true, onClose });
    await waitFor(() => expect(screen.getByText('Tasks')).toBeInTheDocument());
    screen.getByText('Tasks').click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rendering with no drawer props at all does not throw — fully optional, backward compatible', async () => {
    mockPermissions([]);
    expect(() => renderSidebar('mock')).not.toThrow();
  });
});

describe('Sidebar — organization logo (Manors cleanup phase, Task #4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no logo when the organization has no branding configured (every organization today)', async () => {
    vi.spyOn(organizationsService, 'getBranding').mockResolvedValue(null);
    mockPermissions([]);
    renderSidebar('mock');
    await waitFor(() => expect(screen.getByText('Manors Cremation')).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: /logo/i })).not.toBeInTheDocument();
  });

  it('renders the configured logo image once branding.logoUrl is set', async () => {
    vi.spyOn(organizationsService, 'getBranding').mockResolvedValue({
      organizationId: DEFAULT_ORGANIZATION_ID,
      logoUrl: 'https://example.com/manors-logo.png',
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      emailFromName: null,
      documentFooter: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockPermissions([]);
    renderSidebar('mock');
    const logo = await screen.findByRole('img', { name: 'Manors Cremation logo' });
    expect(logo).toHaveAttribute('src', 'https://example.com/manors-logo.png');
  });

  it('still renders the staff-online status alongside the logo — the logo never replaces it', async () => {
    vi.spyOn(organizationsService, 'getBranding').mockResolvedValue({
      organizationId: DEFAULT_ORGANIZATION_ID,
      logoUrl: 'https://example.com/manors-logo.png',
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      emailFromName: null,
      documentFooter: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockPermissions([]);
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(4);
    renderSidebar('identity');
    await screen.findByRole('img', { name: 'Manors Cremation logo' });
    expect(await screen.findByText('4 staff online')).toBeInTheDocument();
  });
});

/**
 * Addendum 2, item #6 (2026-10). "Settings" expands in place to show its
 * own sub-pages, using the exact same `useSettingsAreas` list/visibility
 * rules the Settings menu itself uses — see settingsAreas.ts. Only
 * renders while on a Settings page (`/settings`, `/settings/*`, or
 * `/unmatched-forms` — item #4's own route, outside `/settings` but
 * still part of this same menu).
 */
describe('Sidebar — Settings expanded submenu (Addendum 2, item #6, 2026-10)', () => {
  afterEach(() => {
    vi.mocked(usePathname).mockReturnValue('/dashboard');
  });

  it('does not expand on an unrelated page (the default "/dashboard" every other test in this file uses)', async () => {
    mockPermissions(['case.create']);
    renderSidebar('mock');
    await screen.findByText('Settings');
    expect(screen.queryByText('Import Existing Jotform')).not.toBeInTheDocument();
  });

  it('expands to show visible sub-areas while on a /settings/* page', async () => {
    vi.mocked(usePathname).mockReturnValue('/settings/team');
    mockPermissions(['case.create', 'caseNumber.manage']);
    renderSidebar('mock');
    await screen.findByText('Settings');
    expect(await screen.findByText('Import Existing Jotform')).toBeInTheDocument();
    expect(screen.getByText('Case Numbering')).toBeInTheDocument();
  });

  it('expands to show visible sub-areas while on /unmatched-forms too, even though that route is outside /settings', async () => {
    vi.mocked(usePathname).mockReturnValue('/unmatched-forms');
    // case.create so canSeeSettings (the top-level "Settings" item's own
    // gate) is satisfied — case.update is what makes Unmatched Forms
    // itself visible within the expanded list.
    mockPermissions(['case.create', 'case.update']);
    renderSidebar('mock');
    await screen.findByText('Settings');
    expect(await screen.findByText('Unmatched Forms')).toBeInTheDocument();
  });

  it('includes item #5\'s Document Templates/Audit Center, with the same identity-mode + permission gate', async () => {
    vi.mocked(usePathname).mockReturnValue('/settings/document-templates');
    mockPermissions(['document.template.manage', 'audit.read']);
    renderSidebar('identity');
    await screen.findByText('Settings');
    expect(await screen.findByText('Document Templates')).toBeInTheDocument();
    expect(screen.getByText('Audit Center')).toBeInTheDocument();
  });

  it('highlights the current sub-page with the selected style, and only that one', async () => {
    vi.mocked(usePathname).mockReturnValue('/settings/case-numbering');
    mockPermissions(['case.create', 'caseNumber.manage']);
    renderSidebar('mock');
    const caseNumbering = await screen.findByText('Case Numbering');
    const importJotform = screen.getByText('Import Existing Jotform');
    expect(caseNumbering.className).toMatch(/settingsSubItemActive/);
    expect(importJotform.className).not.toMatch(/settingsSubItemActive/);
  });

  it('never expands when the caller has no visible sub-areas at all, even while on /settings', async () => {
    vi.mocked(usePathname).mockReturnValue('/settings');
    mockPermissions([]);
    renderSidebar('identity');
    await screen.findByText('Settings');
    // Security is always visible in identity mode, so this caller DOES
    // have a sub-area — confirm it renders instead, proving the describe
    // block's premise (an identity-mode caller always sees Security).
    expect(await screen.findByText('Security')).toBeInTheDocument();
  });
});

/**
 * Addendum 2, item #1 (2026-10). The "N staff online" hover/focus
 * popover. `fetchActiveStaffList` is mocked to resolve `[]` by default
 * (see the top-of-file `identityAuthClient` mock) — these tests override
 * it per case. The full grouping/visibility logic itself is unit-tested
 * directly in StaffOnlinePopover.test.tsx; this file only confirms it's
 * correctly wired into the sidebar footer.
 */
describe('Sidebar — staff online popover (Addendum 2, item #1, 2026-10)', () => {
  it('does not fetch the staff list until the card is hovered/focused', async () => {
    mockPermissions([]);
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(2);
    renderSidebar('identity');
    await screen.findByText('2 staff online');
    expect(identityAuthClient.fetchActiveStaffList).not.toHaveBeenCalled();
  });

  it('fetches and shows the list once the card is hovered', async () => {
    mockPermissions([]);
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(1);
    vi.mocked(identityAuthClient.fetchActiveStaffList).mockResolvedValue([{ displayName: 'Dana Reyes', roleKey: 'manager' }]);
    renderSidebar('identity');
    const card = await screen.findByText('1 staff online');
    fireEvent.mouseEnter(card);
    expect(await screen.findByText('Dana Reyes')).toBeInTheDocument();
    expect(identityAuthClient.fetchActiveStaffList).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID);
  });
});

