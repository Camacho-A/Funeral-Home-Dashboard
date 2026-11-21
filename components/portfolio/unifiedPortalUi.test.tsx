import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Unified portal (Phase 5N) — the selector, the new-case organization choice and the combined-view notice. */
const portfolio = vi.hoisted(() => ({
  value: {
    organizations: [
      { organizationId: 'gus-camacho-jr', displayName: 'Gus Camacho Jr. Funeral Home', role: 'manager', isCurrent: true },
      { organizationId: 'managed-cremations', displayName: 'Manors Cremation', role: 'officeStaff', isCurrent: false },
    ],
    isMultiOrganization: true,
    combined: false,
    setCombined: vi.fn(),
    workingOrganizationId: 'gus-camacho-jr',
    isLoading: false,
  },
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), pathname: '/tasks' }));
const permissionsByOrg = vi.hoisted(() => ({ value: {} as Record<string, string[]> }));
const historicalOrgs = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock('@/hooks/usePortfolio', () => ({ usePortfolio: () => portfolio.value }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh }), usePathname: () => nav.pathname }));
vi.mock('@/lib/identityAuthClient', () => ({ switchOrganization: vi.fn(async () => undefined) }));
vi.mock('@/hooks/useRbac', () => ({ useMyPermissions: (organizationId: string) => ({ isLoading: false, data: { permissions: permissionsByOrg.value[organizationId] ?? [] } }) }));
vi.mock('@/domain/organization/organizationTransition', () => ({ organizationAcceptsNewCases: (id: string) => !historicalOrgs.value.has(id) }));

const { OrganizationSelector, ALL_ORGANIZATIONS_VALUE } = await import('@/components/layout/OrganizationSelector');
const { OrganizationChoiceModal } = await import('./OrganizationChoiceModal');
const { CombinedViewNotice } = await import('./CombinedViewNotice');
const identityAuthClient = await import('@/lib/identityAuthClient');

beforeEach(() => {
  portfolio.value = { ...portfolio.value, combined: false, isMultiOrganization: true, setCombined: vi.fn() };
  nav.push.mockReset();
  nav.refresh.mockReset();
  nav.pathname = '/tasks';
  permissionsByOrg.value = { 'gus-camacho-jr': ['case.create'], 'managed-cremations': ['case.create'] };
  historicalOrgs.value = new Set();
  vi.mocked(identityAuthClient.switchOrganization).mockClear();
});
afterEach(() => cleanup());

describe('organization selector', () => {
  it('lists "All authorized organizations" and only the person\'s own organizations', () => {
    render(<OrganizationSelector />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['All authorized organizations', 'Gus Camacho Jr. Funeral Home', 'Manors Cremation']);
  });

  it('is not shown to someone in one organization', () => {
    portfolio.value = { ...portfolio.value, isMultiOrganization: false };
    const { container } = render(<OrganizationSelector />);
    expect(container.innerHTML).toBe('');
  });

  it('"All" switches nothing on the server: it only turns on the combined view', () => {
    render(<OrganizationSelector />);
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: ALL_ORGANIZATIONS_VALUE } });
    expect(portfolio.value.setCombined).toHaveBeenCalledWith(true);
    expect(identityAuthClient.switchOrganization).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith('/dashboard');
  });

  it('choosing one organization asks the server to switch, then reloads', async () => {
    render(<OrganizationSelector />);
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'managed-cremations' } });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(identityAuthClient.switchOrganization).toHaveBeenCalledWith('managed-cremations');
    expect(portfolio.value.setCombined).toHaveBeenCalledWith(false);
  });

  it('in the combined view, says it is viewing only', () => {
    portfolio.value = { ...portfolio.value, combined: true };
    render(<OrganizationSelector />);
    expect(screen.getByText(/Viewing only/)).toBeTruthy();
  });
});

describe('new case: the funeral home is chosen explicitly', () => {
  it('offers each organization; a historical one, or one where the role cannot create cases, is disabled with the reason', () => {
    historicalOrgs.value = new Set(['managed-cremations']);
    render(<OrganizationChoiceModal open onClose={() => undefined} onChosen={() => undefined} />);
    expect((screen.getByTestId('choose-managed-cremations') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Historical/)).toBeTruthy();
    cleanup();
    historicalOrgs.value = new Set();
    permissionsByOrg.value = { 'gus-camacho-jr': ['case.create'], 'managed-cremations': [] };
    render(<OrganizationChoiceModal open onClose={() => undefined} onChosen={() => undefined} />);
    expect((screen.getByTestId('choose-managed-cremations') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/cannot create cases/)).toBeTruthy();
  });

  it('choosing the working organization opens New Case there, with no switch', () => {
    const onChosen = vi.fn();
    render(<OrganizationChoiceModal open onClose={() => undefined} onChosen={onChosen} />);
    fireEvent.click(screen.getByTestId('choose-gus-camacho-jr'));
    expect(onChosen).toHaveBeenCalledWith('gus-camacho-jr');
    expect(identityAuthClient.switchOrganization).not.toHaveBeenCalled();
  });
});

describe('combined-view notice', () => {
  it('on a single-organization page in the combined view, says which organization the page and its changes belong to', () => {
    portfolio.value = { ...portfolio.value, combined: true };
    render(<CombinedViewNotice />);
    expect(screen.getByTestId('combined-view-notice').textContent).toMatch(/Gus Camacho Jr\. Funeral Home only/);
  });

  it('not on the combined Dashboard, and not outside the combined view', () => {
    portfolio.value = { ...portfolio.value, combined: true };
    nav.pathname = '/dashboard';
    const first = render(<CombinedViewNotice />);
    expect(first.container.innerHTML).toBe('');
    cleanup();
    portfolio.value = { ...portfolio.value, combined: false };
    nav.pathname = '/tasks';
    expect(render(<CombinedViewNotice />).container.innerHTML).toBe('');
  });
});
