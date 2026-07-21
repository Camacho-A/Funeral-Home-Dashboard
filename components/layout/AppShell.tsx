import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import styles from './AppShell.module.css';

/**
 * The persistent app chrome (Frontend Engineering Plan, Phase 2): sidebar +
 * top bar + a scrollable main content region. Renders <main id="main-content">
 * to satisfy the skip-link contract established in app/layout.tsx (Phase 0).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.mainColumn}>
        <TopBar />
        <main id="main-content" className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
