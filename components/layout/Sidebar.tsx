import { SidebarNavItem, SidebarNavItemInert } from './SidebarNavItem';
import styles from './Sidebar.module.css';

/**
 * Persistent app sidebar (Frontend Engineering Plan, Phase 2). Org name and
 * staff-online count are static placeholders for now — Phase 4 wires these to
 * useOrganization()/useStaff() once those exist.
 */
export function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden="true" />
        <div className={styles.brandWordmark}>Beacon</div>
      </div>

      <div className={styles.navList}>
        <SidebarNavItem href="/dashboard" label="Dashboard" />
        <SidebarNavItem href="/tasks" label="Tasks" />
        <SidebarNavItem href="/reports" label="Reports" />
        <SidebarNavItemInert label="Settings" />
      </div>

      <div className={styles.footer}>
        Manor Cremation
        <br />
        <span className={styles.footerStaffOnline}>3 staff online</span>
      </div>
    </nav>
  );
}
