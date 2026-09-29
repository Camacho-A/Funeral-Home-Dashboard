'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AuthAdapterMode } from '@/lib/env';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useWorkflowTemplates } from '@/hooks/useWorkflowTemplates';
import { WorkflowTemplateList } from '@/components/settings/WorkflowTemplateList';
import { WorkflowEditor } from '@/components/settings/WorkflowEditor';
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
 * The pre-existing Workflow Template management UI (Phase 18 — this
 * route's original content) is preserved below the new cards, completely
 * unchanged, under its own heading.
 */
export function SettingsHub({ authAdapterMode }: { authAdapterMode: AuthAdapterMode }) {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const permissions = permissionsQuery.data?.permissions ?? [];

  const { data: templates = [], isPending: templatesPending } = useWorkflowTemplates();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isImportModalOpen, setImportModalOpen] = useState(false);

  const activeTemplateId = selectedTemplateId ?? templates[0]?.id ?? null;
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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Workflow Templates</h2>
        {templatesPending ? (
          <p className={styles.loading}>Loading workflow templates…</p>
        ) : (
          <div className={styles.columns}>
            <WorkflowTemplateList
              templates={templates.map((t) => ({ id: t.id, name: t.name, isEnabled: t.isEnabled, caseTypes: t.caseTypes }))}
              selectedTemplateId={activeTemplateId}
              onSelect={setSelectedTemplateId}
            />
            {activeTemplateId && <WorkflowEditor key={activeTemplateId} templateId={activeTemplateId} />}
          </div>
        )}
      </section>

      <ImportHistoricalCaseModal open={isImportModalOpen} onClose={() => setImportModalOpen(false)} />
    </div>
  );
}
