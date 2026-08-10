'use client';

import type { AuthAdapterMode } from '@/lib/env';
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
 *
 * Phase 31 (Financial Management & General Ledger): `/accounting` gets its
 * own top-level entry, matching how Calendar/Tasks/Reports already got
 * theirs (not buried in Settings — this is a full subsystem). Gated on
 * `authAdapterMode === 'identity'`, the same pattern TopBar's own RBAC-only
 * links already use, since access is governed by the new `accounting.*`
 * permissions which only exist under that auth mode.
 */
export function Sidebar({ authAdapterMode }: { authAdapterMode?: AuthAdapterMode }) {
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
        <SidebarNavItem href="/calendar" label="Calendar" />
        <SidebarNavItem href="/reports" label="Reports" />
        {authAdapterMode === 'identity' && <SidebarNavItem href="/accounting" label="Accounting" />}
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
