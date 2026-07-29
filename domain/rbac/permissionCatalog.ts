/**
 * Phase 22 (Role-Based Access Control). The complete, closed catalog of
 * permission keys Beacon's authorization model can ever grant — every
 * `roles`/`rolePermissions` row and every `AuthorizationPolicyService`
 * check is validated against this list, never an ad hoc string. Grouped
 * by the resource it governs (`<resource>.<action>`), matching the
 * catalog in the phase spec exactly.
 */
export const PERMISSION_KEYS = [
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

  'report.view',

  /** Phase 24 (Case Activity Timeline & Audit Center). Deliberately only
      two keys, not three: the Case Activity tab is gated by the existing
      `case.read` (no role can read a case's data but not its history —
      a separate `audit.case.read` would be a distinction with no real
      difference). These two gate the org-wide, cross-case Audit Center,
      which has no existing equivalent permission. */
  'audit.read',
  'audit.export',

  'organization.manage',

  'user.invite',
  'user.remove',
  'user.manageRoles',

  'settings.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** The resource a permission key governs — `'case.read'` -> `'case'`. Used
    only for grouping in the Permission Matrix / Permission Inspector UI. */
export function permissionCategory(key: PermissionKey): string {
  return key.split('.')[0];
}

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'case.read': 'View case records',
  'case.create': 'Create new case records',
  'case.update': 'Edit case records',
  'case.delete': 'Delete case records',

  'caseOrder.read': "View a case's order (services and merchandise selections)",
  'caseOrder.update': "Edit a case's order",

  'workflow.read': 'View workflow templates',
  'workflow.edit': 'Edit workflow templates',
  'workflow.publish': 'Publish a new workflow template version',

  'payment.read': 'View payment records',
  'payment.collect': 'Collect a payment',
  'payment.refund': 'Refund or cancel a payment',

  'serviceCatalog.read': 'View the service/merchandise catalog',
  'serviceCatalog.edit': 'Edit the service/merchandise catalog',

  'document.generate': 'Generate documents',
  'document.view': 'View generated documents',

  'report.view': 'View reports',

  'audit.read': 'View the organization-wide activity and audit log',
  'audit.export': 'Export activity and audit log data',

  'organization.manage': "Manage the organization's own profile and settings",

  'user.invite': 'Invite a new user to the organization',
  'user.remove': "Remove a user from the organization's membership",
  'user.manageRoles': 'Create, edit, and assign roles',

  'settings.manage': "Manage the organization's configuration settings",
};
