import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarNavItem } from './SidebarNavItem';

let mockPathname = '/dashboard';
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }));

/**
 * Item #5 (2026-09, navigation cleanup). Team/Security/Roles & Permissions/
 * Case Numbering no longer have their own Sidebar entries — the Settings
 * SidebarNavItem's existing prefix-match active-state logic (`pathname ===
 * href || pathname.startsWith(`${href}/`)`) already covers highlighting
 * Settings as active while the user is inside any of them, since they all
 * live under /settings/*. No new active-state logic was needed; this
 * proves the pre-existing mechanism actually covers every one of those
 * routes.
 */
describe('SidebarNavItem — Settings active-state covers its administrative sub-routes (item #5, 2026-09)', () => {
  it.each([
    ['/settings', true],
    ['/settings/team', true],
    ['/settings/security', true],
    ['/settings/roles', true],
    ['/settings/case-numbering', true],
    ['/settings/audit', true],
    ['/dashboard', false],
    ['/settings-other', false],
  ])('15: pathname %s -> active=%s for href="/settings"', (pathname, expectedActive) => {
    mockPathname = pathname;
    render(<SidebarNavItem href="/settings" label="Settings" />);
    const link = screen.getByText('Settings');
    if (expectedActive) {
      expect(link.className).toMatch(/itemActive/);
    } else {
      expect(link.className).not.toMatch(/itemActive/);
    }
  });
});

describe('SidebarNavItem — mobile navigation drawer (2026-09)', () => {
  it('calls onNavigate when clicked, so the Sidebar can close the drawer on tap', () => {
    mockPathname = '/dashboard';
    const onNavigate = vi.fn();
    render(<SidebarNavItem href="/tasks" label="Tasks" onNavigate={onNavigate} />);
    screen.getByText('Tasks').click();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('renders normally with no onNavigate at all (desktop\'s unchanged default)', () => {
    mockPathname = '/dashboard';
    expect(() => render(<SidebarNavItem href="/tasks" label="Tasks" />)).not.toThrow();
    screen.getByText('Tasks').click();
  });
});
