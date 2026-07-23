'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { SidebarNavItem } from './SidebarNavItem';
import styles from './Sidebar.module.css';

/**
 * Persistent app sidebar (Frontend Engineering Plan, Phase 2). Org name
 * reads from useOrganizationRecord() (Phase 15A — Wix-backed in `wix` mode,
 * fixture-backed in `mock` mode, same Organization shape either way).
 * Falls back to the raw organizationId if the record hasn't loaded yet or
 * couldn't be found — the same "always show something" behavior the prior
 * mock-only lookup already had. Staff-online count remains a static
 * placeholder, unchanged, until useStaff()-backed aggregation exists.
 */
export function Sidebar() {
  const { organizationId } = useOrganization();
  const { data: organization } = useOrganizationRecord();
  const organizationName = organization?.name ?? organizationId;

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
        <SidebarNavItem href="/settings" label="Settings" />
      </div>

      <div className={styles.footer}>
        {organizationName}
        <br />
        <span className={styles.footerStaffOnline}>3 staff online</span>
      </div>
    </nav>
  );
}
