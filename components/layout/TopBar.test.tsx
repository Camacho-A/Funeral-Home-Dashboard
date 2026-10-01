import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { SessionProvider } from '@/hooks/useSession';

// Only needed for the identity-mode Audit/Templates test below, which
// also renders OrganizationSwitcher (authAdapterMode === 'identity') —
// that component calls useRouter(), which needs a real App Router
// context none of this file's other tests exercise.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/**
 * Manors go-live fix (real session identity). TopBar's avatar/signed-in
 * display must reflect whatever SessionProvider actually supplies — never
 * a hardcoded fixture like "Dana" — since that hardcoding was the exact,
 * disclosed production bug this task fixes (every real Manors employee
 * saw "Dana" as their own avatar regardless of who was actually logged
 * in). The test session below deliberately uses a name that matches no
 * services/__mocks__/fixtures.ts staff record, so a pass here can only
 * mean the value came from SessionProvider, not from any fixture.
 *
 * TopBar also calls useOrganizationRecord()/useMyPermissions()/
 * useUnreadNotificationCount()/useMyMemberships() — all real `fetch`-based
 * hooks regardless of OrganizationProvider's dataAdapterMode (see each
 * service's own comment on why). A single generic fetch stub satisfies
 * every one of their expected response shapes at once; none of their
 * resolved data affects the assertion this file cares about.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    }),
  );
});

const TEST_SESSION = { staffId: 'staff-test-session', displayName: 'Jordan Rivera' };
const ANGELICA_SESSION = { staffId: 'staff-angelica', displayName: 'Angelica Camacho' };

function renderTopBar(session: { staffId: string | null; displayName: string } = TEST_SESSION) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <SessionProvider value={session}>
          <TopBar />
        </SessionProvider>
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

/**
 * Mobile TopBar design correction (2026-09): the account's initials now
 * render TWICE — once in the desktop-only avatar (`.desktopAccountGroup`,
 * CSS-hidden on mobile) and once inside the mobile-only AccountMenu
 * trigger (CSS-hidden on desktop) — see TopBar.tsx's own comment for why
 * both representations exist in the DOM at once. Every initials
 * assertion below that used to expect exactly one match now expects two.
 */
describe('TopBar — real session identity (Manors go-live fix)', () => {
  it('displays the authenticated employee from SessionProvider, not a hardcoded fixture', () => {
    renderTopBar();
    expect(screen.getAllByText('JR')).toHaveLength(2);
    expect(screen.queryByText('DA')).not.toBeInTheDocument();
  });

  it('reflects a different SessionProvider value on a subsequent render', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider>
          <SessionProvider value={{ staffId: 'staff-other', displayName: 'Priya Nair' }}>
            <TopBar />
          </SessionProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    expect(screen.getAllByText('PN')).toHaveLength(2);
  });
});

describe('TopBar — item #6 clarification (2026-09): employee initials avatar', () => {
  it('1/2: shows "AC" for Angelica Camacho, never "AN"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar(ANGELICA_SESSION);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getAllByText('AC')).toHaveLength(2);
    expect(screen.queryByText('AN')).not.toBeInTheDocument();
  });

  it('shows the full employee name ("Angelica Camacho") alongside the initials avatar and Sign out', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar(ANGELICA_SESSION);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText('Angelica Camacho')).toBeInTheDocument();
    expect(screen.getAllByText('AC')).toHaveLength(2);
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('4: other employees each receive their own correct first/last initials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar({ staffId: 'staff-john', displayName: 'John Smith' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getAllByText('JS')).toHaveLength(2);
  });

  it('5: a single-name session falls back safely to that name\'s own initial', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar({ staffId: 'staff-cher', displayName: 'Cher' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getAllByText('C')).toHaveLength(2);
  });
});

describe('TopBar — mobile navigation drawer (2026-09)', () => {
  it('renders a hamburger button that calls onMenuClick when clicked', () => {
    const queryClient = new QueryClient();
    const onMenuClick = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider>
          <SessionProvider value={TEST_SESSION}>
            <TopBar onMenuClick={onMenuClick} />
          </SessionProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    screen.getByRole('button', { name: 'Open navigation menu' }).click();
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('renders with no onMenuClick at all without throwing (desktop\'s unchanged default)', () => {
    expect(() => renderTopBar()).not.toThrow();
    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toBeInTheDocument();
  });
});

/**
 * Mobile TopBar design correction (2026-09). Whether these elements are
 * actually HIDDEN at a given width is a CSS/media-query fact jsdom can't
 * evaluate (no real layout engine) — covered instead by this phase's own
 * live-browser verification, the same way every earlier CSS-only
 * responsive change in this project's Dashboard mobile-friendliness work
 * was verified. What IS meaningfully jsdom-testable, and asserted here,
 * is the STRUCTURAL contract the CSS relies on: the employee name and
 * the standalone "Sign out" link are scoped inside the one wrapper
 * (`desktopAccountGroup`) the mobile breakpoint hides as a unit, and the
 * mobile AccountMenu control is present in the DOM unconditionally
 * (never only rendered for a specific breakpoint via JS).
 */
describe('TopBar — mobile TopBar design correction (2026-09)', () => {
  it('the employee name and the standalone Sign out form are both scoped inside the desktop-only wrapper', () => {
    const { container } = renderTopBar(ANGELICA_SESSION);
    const desktopGroup = container.querySelector('[class*="desktopAccountGroup"]');
    expect(desktopGroup).not.toBeNull();
    expect(desktopGroup).toHaveTextContent('Angelica Camacho');
    expect(desktopGroup?.querySelector('form button[type="submit"]')).toHaveTextContent('Sign out');
  });

  it('the mobile AccountMenu control (the account avatar as a real button) is present, independent of the desktop group', () => {
    renderTopBar(ANGELICA_SESSION);
    expect(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' })).toBeInTheDocument();
  });

  it('desktop account behavior does not regress: name, avatar, and a standalone, always-visible Sign out control are still all present together', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar(ANGELICA_SESSION);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText('Angelica Camacho')).toBeInTheDocument();
    expect(screen.getAllByText('AC')).toHaveLength(2);
    // The standalone Sign out control — distinct from the one inside the
    // (closed, not rendered) AccountMenu popover — is unconditionally in
    // the DOM, exactly as before this phase.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Audit and Templates carry the mobile priority-row class (order, verified live in this phase\'s own report — identity-mode auth wasn\'t reachable in this sandbox\'s test login)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: ['audit.read', 'document.template.manage'], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationProvider>
          <SessionProvider value={TEST_SESSION}>
            <TopBar authAdapterMode="identity" />
          </SessionProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});

    const audit = screen.getByText('Audit');
    const templates = screen.getByText('Templates');
    expect(audit.className).toMatch(/priorityLink/);
    expect(templates.className).toMatch(/priorityLink/);
    // Neither link is scoped inside the overflow group (Resources/
    // Merchandise/etc.) — distinct classes for distinct mobile rows.
    expect(audit.className).not.toMatch(/overflowLink/);
    expect(container.querySelectorAll('[class*="priorityLink"]')).toHaveLength(2);
  });

  it('opening the AC menu reveals Audit and Templates there too, pointing at the exact same destinations as the desktop links — not a duplicated route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: ['audit.read', 'document.template.manage'], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationProvider>
          <SessionProvider value={TEST_SESSION}>
            <TopBar authAdapterMode="identity" />
          </SessionProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});

    // Closed by default: the AC menu's own Audit/Templates aren't
    // rendered yet, so only the desktop links exist — one of each.
    expect(screen.getAllByText('Audit')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^Account menu for/ }));

    const auditLinks = screen.getAllByText('Audit');
    const templatesLinks = screen.getAllByText('Templates');
    expect(auditLinks).toHaveLength(2);
    expect(templatesLinks).toHaveLength(2);
    // Every "Audit"/"Templates" instance — desktop's and the menu's —
    // points at the identical href.
    for (const link of auditLinks) expect(link).toHaveAttribute('href', '/settings/audit');
    for (const link of templatesLinks) expect(link).toHaveAttribute('href', '/settings/document-templates');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('a caller with neither permission sees no Audit/Templates anywhere, including inside the AC menu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationProvider>
          <SessionProvider value={TEST_SESSION}>
            <TopBar authAdapterMode="identity" />
          </SessionProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: /^Account menu for/ }));
    expect(screen.queryByText('Audit')).not.toBeInTheDocument();
    expect(screen.queryByText('Templates')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('the notification control renders both its desktop text and its mobile icon representation — one control, not two', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderTopBar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const bellButtons = screen.getAllByRole('button', { name: 'Notifications' });
    expect(bellButtons).toHaveLength(1);
    expect(bellButtons[0].querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[class*="bellLabel"]')).toHaveTextContent('Notifications');
  });
});

describe('TopBar — item #5 (2026-09, navigation cleanup): admin tools no longer render here', () => {
  it("2/3/4/5: Import Existing Jotform, Security, Roles, and Case Numbering are not offered here — even for a caller with every relevant permission — they've moved to Settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        organization: null,
        permissions: ['case.create', 'user.manageRoles', 'user.invite', 'caseNumber.manage'],
        count: 0,
        organizations: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.queryByText('Import Existing Jotform Case')).not.toBeInTheDocument();
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
    expect(screen.queryByText('Roles')).not.toBeInTheDocument();
    expect(screen.queryByText('Team')).not.toBeInTheDocument();
    expect(screen.queryByText('Case Numbering')).not.toBeInTheDocument();
  });
});
