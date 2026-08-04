import { type PermissionKey } from './permissionCatalog';

/**
 * Phase 22 (Role-Based Access Control). The seven platform-default,
 * organization-scoped roles named in the phase spec. Every organization
 * gets one `organizationRoles` enablement row per entry here at creation
 * time (see `services/roleService.ts`'s `seedDefaultRoles`) — these are
 * the *only* roles that exist until an organization clones one into a
 * custom role. Platform defaults are immutable (`isSystemDefault: true`);
 * `RoleService.updateRole`/`deleteRole` refuse to act on them.
 *
 * `key` is the stable identifier stored on a `roles` row and (via
 * `legacyRoleAliases.ts`) reachable from the pre-existing
 * `Membership.role`/`OrganizationMembership.role` string values, so no
 * existing membership row ever needs to change for this phase to resolve
 * its permissions correctly.
 */
export type DefaultRoleKey = 'administrator' | 'manager' | 'funeralDirector' | 'arranger' | 'officeStaff' | 'accounting' | 'readOnly';

export const DEFAULT_ROLE_KEYS: readonly DefaultRoleKey[] = [
  'administrator',
  'manager',
  'funeralDirector',
  'arranger',
  'officeStaff',
  'accounting',
  'readOnly',
];

export type DefaultRoleDefinition = {
  key: DefaultRoleKey;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
};

const ALL_PERMISSIONS: readonly PermissionKey[] = [
  'case.read',
  'case.create',
  'case.update',
  'case.delete',
  'caseOrder.read',
  'caseOrder.update',
  'workflow.read',
  'workflow.edit',
  'workflow.publish',
  'payment.read',
  'payment.collect',
  'payment.refund',
  'serviceCatalog.read',
  'serviceCatalog.edit',
  'document.generate',
  'document.view',
  'document.upload',
  'document.archive',
  'document.template.read',
  'document.template.manage',
  'signature.request',
  'signature.read',
  'signature.cancel',
  'signature.manage',
  'schedule.read',
  'schedule.create',
  'schedule.edit',
  'schedule.cancel',
  'resource.manage',
  'calendar.manage',
  'notification.read',
  'notification.send',
  'notification.manage',
  'notification.admin',
  'report.view',
  'audit.read',
  'audit.export',
  'organization.manage',
  'user.invite',
  'user.remove',
  'user.manageRoles',
  'settings.manage',
];

export const DEFAULT_ROLE_DEFINITIONS: readonly DefaultRoleDefinition[] = [
  {
    key: 'administrator',
    name: 'Administrator',
    description: 'Full access to every case, workflow, payment, and organization setting.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Broad operational oversight of cases, workflows, and payments, without organization- or role-management access.',
    permissions: [
      'case.read',
      'case.create',
      'case.update',
      'caseOrder.read',
      'caseOrder.update',
      'workflow.read',
      'workflow.edit',
      'workflow.publish',
      'payment.read',
      'payment.collect',
      'serviceCatalog.read',
      'serviceCatalog.edit',
      'document.generate',
      'document.view',
      'document.upload',
      'document.archive',
      'document.template.read',
      'document.template.manage',
      'signature.request',
      'signature.read',
      'signature.cancel',
      'signature.manage',
      'schedule.read',
      'schedule.create',
      'schedule.edit',
      'schedule.cancel',
      'resource.manage',
      'calendar.manage',
      'notification.read',
      'notification.send',
      'notification.manage',
      'notification.admin',
      'report.view',
      'audit.read',
      'audit.export',
      'user.invite',
    ],
  },
  {
    key: 'funeralDirector',
    name: 'Funeral Director',
    description: 'Manages cases and family-facing arrangements day to day.',
    permissions: [
      'case.read',
      'case.create',
      'case.update',
      'caseOrder.read',
      'caseOrder.update',
      'workflow.read',
      'payment.read',
      'payment.collect',
      'serviceCatalog.read',
      'document.generate',
      'document.view',
      'document.upload',
      'document.archive',
      'document.template.read',
      'signature.request',
      'signature.read',
      'signature.cancel',
      'schedule.read',
      'schedule.create',
      'schedule.edit',
      'schedule.cancel',
      'notification.read',
      'notification.send',
      'report.view',
      'audit.read',
    ],
  },
  {
    key: 'arranger',
    name: 'Arranger',
    description: 'Front-line case intake and arrangement work, without payment or reporting access.',
    permissions: [
      'case.read',
      'case.create',
      'case.update',
      'caseOrder.read',
      'caseOrder.update',
      'serviceCatalog.read',
      'document.generate',
      'document.view',
      'document.upload',
      'signature.request',
      'signature.read',
      'schedule.read',
      'schedule.create',
      'schedule.edit',
      'notification.send',
    ],
  },
  {
    key: 'officeStaff',
    name: 'Office Staff',
    description: 'Administrative support — can view and update cases, and generate documents, without payment or workflow access.',
    permissions: [
      'case.read',
      'case.update',
      'caseOrder.read',
      'serviceCatalog.read',
      'document.generate',
      'document.view',
      'document.upload',
      'signature.request',
      'signature.read',
      'schedule.read',
      'schedule.create',
      'schedule.edit',
      'notification.send',
    ],
  },
  {
    key: 'accounting',
    name: 'Accounting',
    description: 'Financial operations across every case — collecting and refunding payments and viewing reports — without case-editing access.',
    permissions: ['case.read', 'caseOrder.read', 'payment.read', 'payment.collect', 'payment.refund', 'notification.read', 'report.view', 'audit.read', 'audit.export'],
  },
  {
    key: 'readOnly',
    name: 'Read Only',
    description: 'View-only access to cases, workflows, payments, the service catalog, documents, and reports.',
    /** Phase 25: deliberately NOT given `document.upload` despite
        `document.view`'s own tier otherwise including this role —
        uploading is a write action, and this is the one role in the
        catalog whose entire permission list is read/view-only today;
        granting it upload would be the first write action readOnly ever
        holds, contradicting its own name and description. Phase 26:
        `signature.read` is a pure view action and fits this role's
        tier exactly; `signature.request`/`.cancel` are withheld for the
        identical reason `document.upload` is. Phase 27: `schedule.read`
        is likewise a pure view action; `schedule.create`/`.edit`/`.cancel`
        are withheld for the same reason. Phase 28: `notification.read`
        is likewise a pure view action (the organization-wide log, not
        this role's own personal inbox, which needs no permission at
        all); `notification.send` is withheld for the identical reason. */
    permissions: [
      'case.read',
      'caseOrder.read',
      'workflow.read',
      'payment.read',
      'serviceCatalog.read',
      'document.view',
      'signature.read',
      'schedule.read',
      'notification.read',
      'report.view',
      'audit.read',
    ],
  },
];

export function isDefaultRoleKey(value: string): value is DefaultRoleKey {
  return (DEFAULT_ROLE_KEYS as readonly string[]).includes(value);
}

export function defaultRoleDefinition(key: DefaultRoleKey): DefaultRoleDefinition {
  const definition = DEFAULT_ROLE_DEFINITIONS.find((d) => d.key === key);
  if (!definition) throw new Error(`No default role definition for key "${key}".`);
  return definition;
}
