'use client';

import { useState } from 'react';
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
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [isNewCaseModalOpen, setNewCaseModalOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.mainColumn}>
        <TopBar onNewCaseClick={() => setNewCaseModalOpen(true)} />
        <main id="main-content" className={styles.content}>
          {children}
        </main>
      </div>
      <NewCaseModal open={isNewCaseModalOpen} onClose={() => setNewCaseModalOpen(false)} />
    </div>
  );
}
