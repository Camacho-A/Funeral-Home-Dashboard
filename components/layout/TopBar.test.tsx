import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { CaseSearchProvider } from '@/hooks/useCaseSearch';
import { SessionProvider } from '@/hooks/useSession';

// Only needed for the identity-mode Audit/Templates test below, which
// also renders OrganizationSwitcher (authAdapterMode === 'identity') —
// that component calls useRouter(), which needs a real App Router
// context none of this file's other tests exercise.
const mockPush = vi.fn();
let mockPathname = '/dashboard';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: () => mockPathname,
}));

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
 * TopBar also calls useOrganizationRecord()/useUnreadNotificationCount()/
 * useMyMemberships() — all real `fetch`-based hooks regardless of
 * OrganizationProvider's dataAdapterMode (see each service's own comment
 * on why). A single generic fetch stub satisfies every one of their
 * expected response shapes at once; none of their resolved data affects
 * the assertion this file cares about. (Addendum 2, item #5, 2026-10:
 * TopBar no longer calls useMyPermissions() itself — Audit/Templates
 * moved to the Settings menu, see below.)
 */
beforeEach(() => {
  mockPush.mockClear();
  mockPathname = '/dashboard';
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
 * SOLIS true redesign, Phase 1 (2026-10): the prior dual identity
 * representation (a desktop-only avatar+name+standalone-Sign-out group,
 * CSS-hidden on mobile, alongside a second, mobile-only AccountMenu) is
 * now a single AccountMenu rendered once, at every width — see
 * TopBar.tsx's own doc comment. Every initials assertion below that used
 * to expect two matches (one per representation) now expects exactly one.
 */
describe('TopBar — real session identity (Manors go-live fix)', () => {
  it('displays the authenticated employee from SessionProvider, not a hardcoded fixture', () => {
    renderTopBar();
    expect(screen.getByText('JR')).toBeInTheDocument();
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
    expect(screen.getByText('PN')).toBeInTheDocument();
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
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.queryByText('AN')).not.toBeInTheDocument();
  });

  it('shows the initials avatar trigger, and Sign out once the account menu is opened', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar(ANGELICA_SESSION);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText('AC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' }));
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
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
    expect(screen.getByText('JS')).toBeInTheDocument();
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
    expect(screen.getByText('C')).toBeInTheDocument();
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
 * SOLIS true redesign, Phase 1 (2026-10): the account avatar menu
 * (AccountMenu) is now the SOLE identity control, rendered once, at every
 * width — there is no more separate desktop-only wrapper or employee-
 * name/standalone-Sign-out-form group to scope tests to; see TopBar.tsx's
 * own doc comment. What remains meaningfully jsdom-testable (whether
 * controls are visually HIDDEN at a given width is a CSS/media-query fact
 * covered by this phase's own live-browser verification instead) is that
 * exactly one AccountMenu control exists, and that it's the only way to
 * reach Sign out now.
 */
describe('TopBar — single AccountMenu identity control (SOLIS true redesign, Phase 1, 2026-10)', () => {
  it('the account menu control (the account avatar as a real button) is present, naming the signed-in employee', () => {
    renderTopBar(ANGELICA_SESSION);
    expect(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' })).toBeInTheDocument();
  });

  it('exactly one AC avatar renders — no separate desktop-only representation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization: null, permissions: [], count: 0, organizations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTopBar(ANGELICA_SESSION);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText('AC')).toBeInTheDocument();
    // Sign out is reachable through the (closed by default) AccountMenu
    // popover — no second, standalone Sign out control exists anymore.
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' }));
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('Addendum 2, item #5 (2026-10): Audit Center/Templates never appear anywhere in TopBar, including inside the AC menu, regardless of permissions — both moved to the Settings menu', async () => {
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

    expect(screen.queryByText('Audit Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Templates')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Account menu for/ }));
    expect(screen.queryByText('Audit Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Templates')).not.toBeInTheDocument();
    // Identity block (name/email) still renders its own one separator
    // above Sign out.
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('the notification control is a single icon button, with its text label present in the DOM (CSS-hidden at every width, SOLIS true redesign Phase 1) for its accessible name', async () => {
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
    expect(container.querySelector('.sr-only')).toHaveTextContent('Notifications');
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

/**
 * Global search routing (2026-10). The TopBar search renders on every
 * portal page, but `/cases` is the only page that reads the shared query
 * and renders results — so typing here from anywhere else did nothing at
 * all, with no indication why. Enter now navigates to the case list,
 * where the already-typed term applies immediately via the shared
 * CaseSearchProvider.
 */
describe('TopBar — global search routing', () => {
  function renderWithSearch(pathname: string) {
    mockPathname = pathname;
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider>
          <SessionProvider value={TEST_SESSION}>
            <CaseSearchProvider>
              <TopBar />
            </CaseSearchProvider>
          </SessionProvider>
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    return screen.getByLabelText('Search cases');
  }

  it('navigates to the case list on Enter when the viewer is somewhere else', () => {
    const input = renderWithSearch('/dashboard');
    fireEvent.change(input, { target: { value: 'morales' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/cases');
  });

  it('keeps the typed term, so the case list can apply it on arrival', () => {
    const input = renderWithSearch('/dashboard');
    fireEvent.change(input, { target: { value: 'morales' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((input as HTMLInputElement).value).toBe('morales');
  });

  it('does not navigate when already on the case list — it filters live there', () => {
    const input = renderWithSearch('/cases');
    fireEvent.change(input, { target: { value: 'morales' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not navigate on Enter with an empty or whitespace-only query', () => {
    const input = renderWithSearch('/dashboard');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not navigate on an ordinary keystroke — only Enter submits', () => {
    const input = renderWithSearch('/dashboard');
    fireEvent.change(input, { target: { value: 'morales' } });
    fireEvent.keyDown(input, { key: 'a' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('focuses the search on the Cmd/Ctrl-K the hint badge advertises', () => {
    const input = renderWithSearch('/dashboard');
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('leaves Cmd/Ctrl-K alone while the viewer is typing in another field', () => {
    const input = renderWithSearch('/dashboard');
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(input);
    other.remove();
  });
});
