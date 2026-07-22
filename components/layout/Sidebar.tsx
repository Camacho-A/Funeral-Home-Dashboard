'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { getMockOrganizationName } from '@/services/__mocks__/authFixtures';
import { SidebarNavItem, SidebarNavItemInert } from './SidebarNavItem';
import styles from './Sidebar.module.css';

/**
 * Persistent app sidebar (Frontend Engineering Plan, Phase 2). Org name now
 * reads from useOrganization() (Organization Naming Cleanup) instead of a
 * hardcoded literal — staff-online count remains a static placeholder,
 * unchanged, until useStaff()-backed aggregation exists.
 */
export function Sidebar() {
  const { organizationId } = useOrganization();
  const organizationName = getMockOrganizationName(organizationId);

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
        {organizationName}
        <br />
        <span className={styles.footerStaffOnline}>3 staff online</span>
      </div>
    </nav>
  );
}
