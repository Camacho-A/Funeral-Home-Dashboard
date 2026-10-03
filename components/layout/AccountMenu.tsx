'use client';

import { useEffect, useRef, useState } from 'react';
import { logoutAction } from '@/app/login/actions';
import { AuditIcon, TemplatesIcon, SignOutIcon } from './navIcons';
import styles from './AccountMenu.module.css';

/**
 * Mobile TopBar design correction (2026-09). The mobile top action row has
 * no room for the desktop identity cluster's full presentation (employee
 * name text + a permanently visible standalone "Sign out" link) — this is
 * the mobile-only replacement: the same AC avatar, now a real button that
 * opens a small account menu containing Sign out. Desktop is untouched —
 * TopBar.tsx still renders the original employee-name/avatar/Sign-out
 * markup unconditionally, CSS-hidden only below the shared 860px
 * breakpoint where this component takes over (see TopBar.module.css).
 * Two representations of "the signed-in account" exist in the DOM
 * simultaneously for this reason (desktop's and this one), each hidden on
 * the other's breakpoint — not a duplicated LAYOUT (plain CSS reflow
 * could never add the open/close menu behavior this needs), so it isn't
 * the "duplicate mobile component" pattern this project otherwise avoids.
 *
 * Reuses the exact same `logoutAction` Server Action TopBar's own
 * standalone Sign out form already posts to — not a second sign-out
 * implementation.
 *
 * SOLIS Final Phase (2026-10), §1.2: this is now the ONLY identity control
 * (TopBar's standalone desktop Audit/Templates links are gone — see
 * TopBar.tsx) — the trigger/menu/identity block/icons below render the
 * sx- design system's literal markup. "Audit" is relabeled "Audit Center"
 * here (AccountMenu.test.tsx updated accordingly — see this phase's own
 * report). ArrowUp/ArrowDown menuitem navigation and focusing the first
 * menuitem on open are new, presentation-adjacent keyboard behavior the
 * spec asks for; Escape/outside-click dismissal and `showAudit`/
 * `showTemplates`'s permission source are unchanged.
 */
export function AccountMenu({
  initials,
  displayName,
  email,
  showAudit = false,
  showTemplates = false,
}: {
  initials: string;
  displayName: string;
  /** SOLIS true redesign, Phase 1 — visual fidelity correction (2026-10).
      Shown in the popover header when available (real session data, see
      types/session.ts#Session.email) — never a fabricated address. */
  email?: string;
  showAudit?: boolean;
  showTemplates?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (!items || items.length === 0) return;
      event.preventDefault();
      const list = Array.from(items);
      const currentIndex = list.indexOf(document.activeElement as HTMLElement);
      const nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, list.length - 1)
          : Math.max(currentIndex - 1, 0);
      list[currentIndex === -1 && event.key === 'ArrowDown' ? 0 : nextIndex]?.focus();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
      >
        <span className="sx-avatar sx-avatar-sm" aria-hidden="true">
          {initials}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="sx-menu" style={{ width: 240 }} role="menu" ref={menuRef}>
          <div className="sx-menu-identity">
            <span className="sx-avatar" aria-hidden="true">
              {initials}
            </span>
            <div>
              <div className="sx-menu-identity-name">{displayName}</div>
              <div className="sx-menu-identity-sub">{email ?? 'Signed in'}</div>
            </div>
          </div>
          <div className="sx-menu-divider" role="separator" />
          {showAudit && (
            <a href="/settings/audit" role="menuitem" className="sx-menu-item" onClick={() => setOpen(false)}>
              <AuditIcon />
              Audit Center
            </a>
          )}
          {showTemplates && (
            <a href="/settings/document-templates" role="menuitem" className="sx-menu-item" onClick={() => setOpen(false)}>
              <TemplatesIcon />
              Templates
            </a>
          )}
          {(showAudit || showTemplates) && <div className="sx-menu-divider" role="separator" />}
          <form action={logoutAction}>
            <button type="submit" role="menuitem" className="sx-menu-item">
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
