'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AuthAdapterMode } from '@/lib/env';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { ImportHistoricalCaseModal } from '@/components/modals/ImportHistoricalCaseModal';
import { Card } from '@/components/ui/Card';
import styles from './SettingsHub.module.css';

type AdminArea = {
  key: string;
  label: string;
  description: string;
  visible: boolean;
} & ({ href: string } | { onClick: () => void });

/**
 * Item #5 (2026-09, navigation cleanup). "Settings" is now the app's one
 * top-level administrative destination — Team/Security/Roles & Permissions/
 * Case Numbering/Import Existing Jotform no longer have their own
 * top-level Sidebar/TopBar entries (see components/layout/TopBar.tsx's own
 * comment). None of those 4 features were rewritten: every card below is a
 * plain link to (or, for Import Existing Jotform, a trigger for) the exact
 * same pre-existing route/modal/permission check that previously lived in
 * TopBar.tsx — moving *where staff discover them from*, never their
 * implementation, permissions, or business logic.
 *
 * Organization Profile (2026-09) is new, not a moved TopBar link — gated
 * on `organization.manage`, org-agnostic (works the same for any tenant,
 * not just Manors). See `components/settings/OrganizationProfilePanel.tsx`.
 *
 * Visibility mirrors each area's previous TopBar gate exactly:
 *   - Team / Roles & Permissions: `authAdapterMode === 'identity'` AND the
 *     same permission (`user.invite` / `user.manageRoles`) TopBar checked.
 *   - Security: `authAdapterMode === 'identity'` only (no specific
 *     permission — every identity-mode session can manage its own
 *     password/sessions), matching TopBar's unconditional-within-identity-
 *     mode gate.
 *   - Case Numbering: `caseNumber.manage` OR `user.manageRoles`, org-agnostic
 *     (unchanged from TopBar's own bootstrap-path comment).
 *   - Import Existing Jotform: `case.create`, org-agnostic.
 * None of this is itself authorization — every route/action re-checks
 * server-side exactly as before; this only decides what's *offered* here.
 *
 * Workflow Templates (Task #11, 2026-09, Settings organization cleanup):
 * previously the one administrative area rendered inline at the bottom of
 * this page, unconditionally — no card, no visibility gate at all, unlike
 * every area above. Moved to its own dedicated `/settings/workflow-templates`
 * route (see that page's own comment) and given a card here like every
 * other area.
 *
 * Security follow-up (2026-09): first gated on `user.manageRoles`
 * (matching Roles & Permissions' own gate above), but that permission is
 * about role/user administration, not workflow administration — Manager
 * (default role) has `workflow.edit`/`workflow.publish` but deliberately
 * NOT `user.manageRoles` ("without organization- or role-management
 * access," see domain/rbac/defaultRoles.ts), so that gate would have hidden
 * this card from exactly the role meant to use it. Switched to
 * `workflow.publish` — already defined in the permission catalog
 * ("Publish a new workflow template version") and already wired into
 * `canPublishWorkflow`, just previously never called from anywhere — the
 * same permission the write route (app/api/workflow-templates/
 * [templateId]/versions/route.ts) now enforces server-side, so the UI and
 * API agree on who's authorized. Reused, not invented.
 */
export function SettingsHub({ authAdapterMode }: { authAdapterMode: AuthAdapterMode }) {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const permissions = permissionsQuery.data?.permissions ?? [];

  const [isImportModalOpen, setImportModalOpen] = useState(false);

  const isIdentityMode = authAdapterMode === 'identity';

  const administration: AdminArea[] = [
    {
      key: 'organization-profile',
      label: 'Organization Profile',
      description: 'Manage your organization’s business information and primary location.',
      href: '/settings/organization-profile',
      visible: permissions.includes('organization.manage'),
    },
    {
      key: 'team',
      label: 'Team',
      description: 'Manage staff accounts and invitations.',
      href: '/settings/team',
      visible: isIdentityMode && permissions.includes('user.invite'),
    },
    {
      key: 'case-numbering',
      label: 'Case Numbering',
      description: 'Manage case number sequencing and formatting.',
      href: '/settings/case-numbering',
      visible: permissions.includes('caseNumber.manage') || permissions.includes('user.manageRoles'),
    },
    {
      key: 'workflow-templates',
      label: 'Workflow Templates',
      description: 'Manage this organization’s case workflow stages and intake fields.',
      href: '/settings/workflow-templates',
      visible: permissions.includes('workflow.publish'),
    },
    {
      key: 'import-jotform',
      label: 'Import Existing Jotform',
      description: 'Import a historical case from an existing Jotform submission.',
      onClick: () => setImportModalOpen(true),
      visible: permissions.includes('case.create'),
    },
  ];

  const securityAndRoles: AdminArea[] = [
    {
      key: 'security',
      label: 'Security',
      description: 'Change your password and manage active sessions.',
      href: '/settings/security',
      visible: isIdentityMode,
    },
    {
      key: 'roles',
      label: 'Roles & Permissions',
      description: 'Manage roles and what each one can access.',
      href: '/settings/roles',
      visible: isIdentityMode && permissions.includes('user.manageRoles'),
    },
  ];

  function renderArea(area: AdminArea) {
    if (!area.visible) return null;
    const content = (
      <Card variant="bordered" className={styles.areaCard}>
        <span className={styles.areaLabel}>{area.label}</span>
        <span className={styles.areaDescription}>{area.description}</span>
      </Card>
    );
    if ('href' in area) {
      return (
        <Link key={area.key} href={area.href} className={styles.areaLink}>
          {content}
        </Link>
      );
    }
    return (
      <button key={area.key} type="button" className={styles.areaButton} onClick={area.onClick}>
        {content}
      </button>
    );
  }

  const visibleAdministration = administration.filter((a) => a.visible);
  const visibleSecurityAndRoles = securityAndRoles.filter((a) => a.visible);

  return (
    <div>
      <h1 className={styles.title}>Settings</h1>

      {visibleAdministration.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Administration</h2>
          <div className={styles.grid}>{visibleAdministration.map(renderArea)}</div>
        </section>
      )}

      {visibleSecurityAndRoles.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Security &amp; Roles</h2>
          <div className={styles.grid}>{visibleSecurityAndRoles.map(renderArea)}</div>
        </section>
      )}

      <ImportHistoricalCaseModal open={isImportModalOpen} onClose={() => setImportModalOpen(false)} />
    </div>
  );
}
