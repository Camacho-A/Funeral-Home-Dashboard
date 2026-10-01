import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountMenu } from './AccountMenu';

function renderMenu() {
  return render(<AccountMenu initials="AC" displayName="Angelica Camacho" />);
}

/**
 * Mobile TopBar design correction (2026-09). AccountMenu is the mobile
 * replacement for the desktop identity cluster's always-visible employee
 * name + standalone "Sign out" link — these tests cover the menu
 * mechanics directly (open/close, outside/Escape dismissal, aria
 * semantics, Sign out wiring). None of this depends on real CSS/media-
 * query evaluation (jsdom doesn't do that), so there's nothing here
 * about which breakpoint shows this component — that's covered by the
 * live-browser verification in this phase's own report, the same way
 * every other CSS-only responsive change in this project's Dashboard
 * mobile-friendliness work was verified, not by a jsdom unit test
 * asserting computed `display`.
 */
describe('AccountMenu', () => {
  it('the account trigger (AC avatar) is present and accessible', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' })).toBeInTheDocument();
  });

  it('starts closed: no menu, aria-expanded="false"', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Account menu for Angelica Camacho' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking the trigger opens the menu and flips aria-expanded to "true"', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' }));
    expect(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('clicking the trigger again closes it (toggle)', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Account menu for Angelica Camacho' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Sign out is present in the open menu, as a real form submission (reusing the existing Server Action, not a new client-side handler)', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' }));
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' });
    expect(signOut).toHaveAttribute('type', 'submit');
    expect(signOut.closest('form')).not.toBeNull();
  });

  it('clicking outside the menu closes it', () => {
    render(
      <div>
        <button type="button">Outside</button>
        <AccountMenu initials="AC" displayName="Angelica Camacho" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking inside the menu does not close it (outside-click detection correctly scopes to the menu root)', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' }));
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('pressing Escape closes the menu', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a different displayName produces a correspondingly different accessible label', () => {
    render(<AccountMenu initials="JR" displayName="Jordan Rivera" />);
    expect(screen.getByRole('button', { name: 'Account menu for Jordan Rivera' })).toBeInTheDocument();
  });
});

/**
 * Mobile TopBar — Audit/Templates moved into AC menu (2026-09). Neither
 * item appears unless explicitly told to via `showAudit`/`showTemplates`
 * — the caller (TopBar.tsx) owns the actual permission check; this
 * component only renders what it's told, exactly like the desktop `<a>`
 * elements it mirrors.
 */
describe('AccountMenu — Audit/Templates (Mobile TopBar, 2026-09)', () => {
  function openMenu(props: Partial<React.ComponentProps<typeof AccountMenu>> = {}) {
    render(<AccountMenu initials="AC" displayName="Angelica Camacho" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Angelica Camacho' }));
  }

  it('neither Audit nor Templates appear by default (no permission granted)', () => {
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Audit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Templates' })).not.toBeInTheDocument();
  });

  it('showAudit renders Audit, pointing at the existing /settings/audit destination — not a new route', () => {
    openMenu({ showAudit: true });
    const audit = screen.getByRole('menuitem', { name: 'Audit' });
    expect(audit).toHaveAttribute('href', '/settings/audit');
  });

  it('showTemplates renders Templates, pointing at the existing /settings/document-templates destination', () => {
    openMenu({ showTemplates: true });
    const templates = screen.getByRole('menuitem', { name: 'Templates' });
    expect(templates).toHaveAttribute('href', '/settings/document-templates');
  });

  it('both can appear together, in order, above a divider, above Sign out', () => {
    openMenu({ showAudit: true, showTemplates: true });
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Audit', 'Templates', 'Sign out']);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('the divider only renders when at least one of Audit/Templates is present — never a dangling separator above Sign out alone', () => {
    openMenu();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('clicking Audit closes the menu (in addition to performing the existing navigation)', () => {
    openMenu({ showAudit: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Audit' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking Templates closes the menu', () => {
    openMenu({ showTemplates: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Templates' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
