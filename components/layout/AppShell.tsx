'use client';

import { SandboxBanner } from '@/components/sandbox/SandboxBanner';
import { useEffect, useState } from 'react';
import type { AuthAdapterMode } from '@/lib/env';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { NewCaseModal } from '@/components/modals/NewCaseModal';
import { PortfolioScopeProvider, usePortfolio } from '@/hooks/usePortfolio';
import { OrganizationChoiceModal } from '@/components/portfolio/OrganizationChoiceModal';
import { CombinedViewNotice } from '@/components/portfolio/CombinedViewNotice';
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
  return (
    <PortfolioScopeProvider enabled={authAdapterMode === 'identity'}>
      <AppShellInner authAdapterMode={authAdapterMode}>{children}</AppShellInner>
    </PortfolioScopeProvider>
  );
}

function AppShellInner({
  children,
  authAdapterMode,
}: {
  children: React.ReactNode;
  authAdapterMode?: AuthAdapterMode;
}) {
  const [isNewCaseModalOpen, setNewCaseModalOpen] = useState(false);
  const [isOrganizationChoiceOpen, setOrganizationChoiceOpen] = useState(false);
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);
  const portfolio = usePortfolio();
  const workingOrganizationName = portfolio.organizations.find((o) => o.organizationId === portfolio.workingOrganizationId)?.displayName;

  // Unified portal (Phase 5N): in the combined view a new case first asks
  // which funeral home it is for; after a switch, the reload lands here
  // with ?newCase=1 and opens New Case in the chosen organization.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('newCase') !== '1') return;
    params.delete('newCase');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    setNewCaseModalOpen(true);
  }, []);
  function handleNewCaseClick() {
    if (portfolio.combined) setOrganizationChoiceOpen(true);
    else setNewCaseModalOpen(true);
  }

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
          onNewCaseClick={handleNewCaseClick}
          authAdapterMode={authAdapterMode}
          onMenuClick={() => setMobileNavOpen(true)}
        />
        {/* UI refresh (2026-11, styles/solis-refresh.css): every page uses the canvas-and-cards design. */}
        <main id="main-content" className={`${styles.content} ${isMobileNavOpen ? styles.contentLocked : ''} sx-refresh`}>
          <SandboxBanner />
          <CombinedViewNotice />
          {children}
        </main>
      </div>
      <NewCaseModal open={isNewCaseModalOpen} onClose={() => setNewCaseModalOpen(false)} organizationName={portfolio.isMultiOrganization ? workingOrganizationName : undefined} />
      <OrganizationChoiceModal
        open={isOrganizationChoiceOpen}
        onClose={() => setOrganizationChoiceOpen(false)}
        onChosen={() => {
          setOrganizationChoiceOpen(false);
          setNewCaseModalOpen(true);
        }}
      />
    </div>
  );
}
