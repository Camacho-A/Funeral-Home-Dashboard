import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { organizationsService } from '@/services/organizationsService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn(), fetchActiveStaffCount: vi.fn() };
});

vi.spyOn(organizationsService, 'get').mockResolvedValue({
  id: DEFAULT_ORGANIZATION_ID,
  name: 'Manors Cremation',
  isActive: true,
});

function mockPermissions(permissions: string[] = []) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

function renderSidebar(authAdapterMode?: 'mock' | 'wix' | 'identity') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <Sidebar authAdapterMode={authAdapterMode} />
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

describe('Sidebar — vertical SOLIS lockup (Task #13 final visual adjustment, 2026-09)', () => {
  it('1: uses ProductBrand\'s vertical variant — mark stacked above centered SOLIS, not the horizontal side-by-side lockup', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    // The vertical variant's own wrapper class (ProductBrand.module.css's
    // .vertical), applied alongside the shared .brand class.
    expect(mark.parentElement?.className).toMatch(/vertical/);
  });

  it('2: still uses the exact same /brand/soliscode-mark.png asset — only size/layout changed, never the artwork', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('src', '/brand/soliscode-mark.png');
  });
});

describe('Sidebar — enlarged SOLIS brand lockup (Task #13 final sizing adjustment, 2026-09)', () => {
  it('1: the mark renders at 96px', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('width', '96');
    expect(mark).toHaveAttribute('height', '96');
  });

  it('2: the SOLIS wordmark uses the enlarged brandWordmark styling (24px, scoped to the Sidebar only)', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const wordmark = await screen.findByText('SOLIS');
    expect(wordmark.className).toMatch(/brandWordmark/);
  });

  it('3: the vertical centered layout is preserved at the new size', async () => {
    mockPermissions([]);
    renderSidebar('mock');
    const mark = await screen.findByRole('presentation', { hidden: true });
    expect(mark.parentElement?.className).toMatch(/vertical/);
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

