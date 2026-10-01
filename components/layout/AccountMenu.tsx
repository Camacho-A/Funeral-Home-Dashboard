'use client';

import { useEffect, useRef, useState } from 'react';
import { logoutAction } from '@/app/login/actions';
import { UserAvatar } from './UserAvatar';
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
 * Mobile TopBar — Audit/Templates moved into AC menu (2026-09): Audit and
 * Templates no longer have their own mobile top-row entries at all
 * (TopBar.module.css hides `.priorityLink` outright below the shared
 * breakpoint, rather than reordering it into row one as before) — this
 * menu is now their only mobile destination. `showAudit`/`showTemplates`
 * are plain booleans TopBar.tsx computes once, from the exact same
 * `authAdapterMode === 'identity' && permissions.includes(...)` check
 * its own (desktop) `<a>` elements already use — this component has no
 * permission logic of its own, and the `href`s below are the identical
 * destinations those desktop links already point to. Not a duplicated
 * routing/business-logic implementation, a second CSS-toggled
 * presentation of the same one.
 */
export function AccountMenu({
  initials,
  displayName,
  showAudit = false,
  showTemplates = false,
}: {
  initials: string;
  displayName: string;
  showAudit?: boolean;
  showTemplates?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
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
        <UserAvatar initials={initials} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {showAudit && (
            <a href="/settings/audit" role="menuitem" className={styles.menuItem} onClick={() => setOpen(false)}>
              Audit
            </a>
          )}
          {showTemplates && (
            <a
              href="/settings/document-templates"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => setOpen(false)}
            >
              Templates
            </a>
          )}
          {(showAudit || showTemplates) && <div className={styles.divider} role="separator" />}
          <form action={logoutAction}>
            <button type="submit" role="menuitem" className={styles.menuItem}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
