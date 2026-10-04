import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StaffOnlinePopover } from './StaffOnlinePopover';
import * as identityAuthClient from '@/lib/identityAuthClient';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchActiveStaffList: vi.fn() };
});

function renderPopover(count = 3) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StaffOnlinePopover organizationId="org-1" count={count}>
        <span>{count} staff online</span>
      </StaffOnlinePopover>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(identityAuthClient.fetchActiveStaffList).mockResolvedValue([
    { displayName: 'Jordan Rivera', roleKey: 'administrator' },
    { displayName: 'Dana Reyes', roleKey: 'manager' },
    { displayName: 'Casey Nguyen', roleKey: 'funeralDirector' },
    { displayName: 'Priya Nair', roleKey: 'officeStaff' },
    { displayName: 'Sam Okafor', roleKey: 'readOnly' },
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Addendum 2, item #1 (2026-10). The sidebar footer's "N staff online"
 * hover/focus popover — children render the existing card unchanged;
 * this component only adds the interactive wrapper and the popover list.
 */
describe('StaffOnlinePopover', () => {
  it('renders the existing card content unchanged, with no popover, before any interaction', () => {
    renderPopover();
    expect(screen.getByText('3 staff online')).toBeInTheDocument();
    expect(screen.queryByText('Jordan Rivera')).not.toBeInTheDocument();
    expect(identityAuthClient.fetchActiveStaffList).not.toHaveBeenCalled();
  });

  it('fetches the list only once opened — never on mount', async () => {
    renderPopover();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(identityAuthClient.fetchActiveStaffList).not.toHaveBeenCalled();
  });

  it('opens on mouse hover and shows the title and every member, grouped', async () => {
    renderPopover(5);
    fireEvent.mouseEnter(screen.getByText('5 staff online').parentElement!);
    expect(identityAuthClient.fetchActiveStaffList).toHaveBeenCalledWith('org-1');
    expect(await screen.findByText('Jordan Rivera')).toBeInTheDocument();
    expect(screen.getByText('5 staff online', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Administrators')).toBeInTheDocument();
    expect(screen.getByText('Managers')).toBeInTheDocument();
    expect(screen.getByText('Funeral Directors')).toBeInTheDocument();
    expect(screen.getByText('Other staff')).toBeInTheDocument();
    expect(screen.getByText('Jordan Rivera')).toBeInTheDocument();
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Casey Nguyen')).toBeInTheDocument();
  });

  it('groups officeStaff and readOnly (and any other non-named role) under "Other staff"', async () => {
    renderPopover();
    fireEvent.mouseEnter(screen.getByText('3 staff online').parentElement!);
    const otherStaffGroup = (await screen.findByText('Other staff')).parentElement!;
    expect(otherStaffGroup).toHaveTextContent('Priya Nair');
    expect(otherStaffGroup).toHaveTextContent('Sam Okafor');
  });

  it('omits a group entirely when it has no one in it', async () => {
    vi.mocked(identityAuthClient.fetchActiveStaffList).mockResolvedValue([{ displayName: 'Jordan Rivera', roleKey: 'administrator' }]);
    renderPopover(1);
    fireEvent.mouseEnter(screen.getByText('1 staff online').parentElement!);
    await screen.findByText('Jordan Rivera');
    expect(screen.getByText('Administrators')).toBeInTheDocument();
    expect(screen.queryByText('Managers')).not.toBeInTheDocument();
    expect(screen.queryByText('Funeral Directors')).not.toBeInTheDocument();
    expect(screen.queryByText('Other staff')).not.toBeInTheDocument();
  });

  it('closes when the pointer leaves', async () => {
    renderPopover();
    const card = screen.getByText('3 staff online').parentElement!;
    fireEvent.mouseEnter(card);
    await screen.findByText('Jordan Rivera');

    fireEvent.mouseLeave(card);
    expect(screen.queryByText('Jordan Rivera')).not.toBeInTheDocument();
  });

  it('opens on focus and closes on blur', async () => {
    renderPopover();
    const card = screen.getByText('3 staff online').parentElement!;
    fireEvent.focus(card);
    await screen.findByText('Jordan Rivera');

    fireEvent.blur(card);
    expect(screen.queryByText('Jordan Rivera')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderPopover();
    const card = screen.getByText('3 staff online').parentElement!;
    fireEvent.mouseEnter(card);
    await screen.findByText('Jordan Rivera');

    fireEvent.keyDown(card, { key: 'Escape' });
    expect(screen.queryByText('Jordan Rivera')).not.toBeInTheDocument();
  });

  it('is keyboard-focusable (tabIndex 0) — hover is not the only way to reach it', () => {
    renderPopover();
    const card = screen.getByText('3 staff online').parentElement!;
    expect(card).toHaveAttribute('tabindex', '0');
  });
});
