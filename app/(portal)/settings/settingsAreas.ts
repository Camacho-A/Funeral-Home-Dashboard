import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import type { AuthAdapterMode } from '@/lib/env';

export type AdminArea = {
  key: string;
  label: string;
  description: string;
  visible: boolean;
} & ({ href: string } | { onClick: () => void });

/**
 * SOLIS Tasks/Calendar/Settings phase, §3.2 — single source of truth for
 * the Settings hub/nav area list, extracted from SettingsHub.tsx (Item #5,
 * 2026-09) without changing any visibility rule. Both SettingsNav (the
 * persistent left nav, every settings page) and SettingsHub (the `/settings`
 * body's `.sx-dir` list) call this.
 *
 * `onImportJotformClick` is supplied by the caller rather than managed here
 * — this hook has no state of its own, so every caller keeps its own
 * `isImportModalOpen` state and its own `<ImportHistoricalCaseModal>`
 * instance (SettingsHub's pre-existing one, unchanged by this phase, plus
 * SettingsNav's). Two independent, self-contained entry points to the same
 * modal — the same "redundant but harmless" pattern the previous phase
 * already established for AccountMenu's Audit/Templates links.
 */
export function useSettingsAreas(authAdapterMode: AuthAdapterMode, onImportJotformClick: () => void) {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const permissions = permissionsQuery.data?.permissions ?? [];
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
      // Addendum 2, item #5 (2026-10): moved here from the initials
      // (AccountMenu) dropdown — same route, same visibility rule
      // (`isIdentityMode && document.template.manage`, mirroring
      // TopBar.tsx's own `showTemplates` computation) as it had there.
      key: 'document-templates',
      label: 'Document Templates',
      description: 'Manage document templates used for case paperwork and forms.',
      href: '/settings/document-templates',
      visible: isIdentityMode && permissions.includes('document.template.manage'),
    },
    {
      key: 'import-jotform',
      label: 'Import Existing Jotform',
      description: 'Import a historical case from an existing Jotform submission.',
      onClick: onImportJotformClick,
      visible: permissions.includes('case.create'),
    },
    {
      key: 'unmatched-forms',
      label: 'Unmatched Forms',
      description: 'Manually link a Jotform submission that could not be auto-matched to a case.',
      href: '/unmatched-forms',
      visible: permissions.includes('case.update'),
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
    {
      // Addendum 2, item #5 (2026-10): moved here from the initials
      // (AccountMenu) dropdown — same route, same visibility rule
      // (`isIdentityMode && audit.read`, mirroring TopBar.tsx's own
      // `showAudit` computation) as it had there.
      key: 'audit',
      label: 'Audit Center',
      description: 'Review the organization’s activity and audit trail.',
      href: '/settings/audit',
      visible: isIdentityMode && permissions.includes('audit.read'),
    },
  ];

  return { administration, securityAndRoles };
}
