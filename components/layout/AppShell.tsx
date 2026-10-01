'use client';

import { useEffect, useState } from 'react';
import type { AuthAdapterMode } from '@/lib/env';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { NewCaseModal } from '@/components/modals/NewCaseModal';
import styles from './AppShell.module.css';

/**
 * The persistent app chrome (Frontend Engineering Plan, Phase 2): sidebar +
 * top bar + a scrollable main content region. Renders <main id="main-content">
 * to satisfy the skip-link contract established in app/layout.tsx (Phase 0).
 *
 * Owns the New Case modal's open/close state (Phase 9) — the "+ New Case"
 * button lives in the persistent TopBar, not any one page, so the modal it
 * opens has to live at this same shared-chrome level rather than in a
 * specific route. Became a Client Component for this reason.
 *
 * Item #5 (2026-09, navigation cleanup): the Import Historical Case modal
 * used to be owned here too (triggered from a TopBar button) — it's now
 * triggered from the Settings hub instead (app/(portal)/settings/
 * SettingsHub.tsx), which owns its own open/close state directly, since
 * only that one page needs it.
 *
 * Mobile navigation drawer (2026-09): same ownership pattern as the New
 * Case modal above — the hamburger button that opens this lives in
 * TopBar, the Sidebar is what visually becomes the drawer, and neither of
 * those two components knows about the other, so the shared open/close
 * state lives here. `isMobileNavOpen` only ever becomes true via that
 * hamburger button, which Sidebar.module.css/TopBar.module.css both keep
 * hidden above their shared 560px breakpoint — so this state existing has
 * no effect at desktop/tablet widths regardless of its value.
 */
export function AppShell({
  children,
  authAdapterMode,
}: {
  children: React.ReactNode;
  authAdapterMode?: AuthAdapterMode;
}) {
  const [isNewCaseModalOpen, setNewCaseModalOpen] = useState(false);
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);

  // Standard off-canvas-drawer behavior: Escape closes it, and the
  // background (the `.content` region, the only thing in this layout
  // that actually scrolls — see AppShell.module.css) stops scrolling
  // while it's open, so a tap-through on the backdrop isn't needed to
  // keep the page from scrolling underneath an open drawer.
  useEffect(() => {
    if (!isMobileNavOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileNavOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileNavOpen]);

  return (
    <div className={styles.shell}>
      <Sidebar authAdapterMode={authAdapterMode} mobileOpen={isMobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      {isMobileNavOpen && (
        <div className={styles.backdrop} onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}
      <div className={styles.mainColumn}>
        <TopBar
          onNewCaseClick={() => setNewCaseModalOpen(true)}
          authAdapterMode={authAdapterMode}
          onMenuClick={() => setMobileNavOpen(true)}
        />
        <main id="main-content" className={`${styles.content} ${isMobileNavOpen ? styles.contentLocked : ''}`}>
          {children}
        </main>
      </div>
      <NewCaseModal open={isNewCaseModalOpen} onClose={() => setNewCaseModalOpen(false)} />
    </div>
  );
}
