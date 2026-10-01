import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './AppShell';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { SessionProvider } from '@/hooks/useSession';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

/**
 * Mobile navigation drawer (2026-09). AppShell owns the open/close state
 * shared between TopBar's hamburger button and the Sidebar it turns into
 * an off-canvas drawer — these tests cover that wiring directly, the same
 * way AppShell already owns (and is implicitly covered via) the New Case
 * modal's open state. `fetch` is stubbed the same generic way
 * Sidebar.test.tsx/TopBar.test.tsx already do, satisfying every hook
 * either child component calls regardless of dataAdapterMode.
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

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <SessionProvider value={{ staffId: 'staff-test', displayName: 'Jordan Rivera' }}>
          <AppShell>
            <div>Page content</div>
          </AppShell>
        </SessionProvider>
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('AppShell — mobile navigation drawer (2026-09)', () => {
  it('the drawer/backdrop are closed by default', () => {
    const { container } = renderShell();
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).not.toMatch(/sidebarOpen/);
    // No backdrop in the DOM at all while closed — AppShell only renders
    // it conditionally, never just visually hidden.
    expect(container.querySelector('[class*="backdrop"]')).toBeNull();
  });

  it('clicking the hamburger button opens the drawer', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).toMatch(/sidebarOpen/);
  });

  it('clicking the backdrop closes the drawer', () => {
    const { container } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).toMatch(/sidebarOpen/);

    const backdrop = container.querySelector('[class*="backdrop"]')!;
    fireEvent.click(backdrop);
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).not.toMatch(/sidebarOpen/);
  });

  it('the Sidebar\'s own close button closes the drawer', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }));
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).not.toMatch(/sidebarOpen/);
  });

  it('clicking a Sidebar nav link closes the drawer', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByText('Tasks'));
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).not.toMatch(/sidebarOpen/);
  });

  it('pressing Escape closes the drawer', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).toMatch(/sidebarOpen/);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('navigation', { name: 'Primary' }).className).not.toMatch(/sidebarOpen/);
  });

  it('locks the main content region from scrolling while the drawer is open', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main.className).not.toMatch(/contentLocked/);

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(main.className).toMatch(/contentLocked/);

    fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }));
    expect(main.className).not.toMatch(/contentLocked/);
  });

  it('still renders the page content passed as children', () => {
    renderShell();
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });
});
