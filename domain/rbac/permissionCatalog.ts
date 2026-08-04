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

  /** `document.generate`/`document.view` were added in Phase 22, ahead of
      any real feature to gate — Phase 25 (Document Generation & Template
      Management) is what finally wires them to a real route/policy
      check. `document.upload`/`document.archive` are new this phase. */
  'document.generate',
  'document.view',
  'document.upload',
  'document.archive',

  /** Phase 25 (Document Generation & Template Management). Gate the
      org-wide Document Template Library — distinct from
      `document.view`/`document.generate` above, which gate a single
      case's documents, mirroring `audit.read`/`audit.export`'s own
      narrower-tier-for-the-write-action split. */
  'document.template.read',
  'document.template.manage',

  /** Phase 26 (Electronic Signatures & Authorization Workflows). A
      distinct `signature` resource, not folded into `document.*` —
      requesting a signature mirrors `document.generate`'s tier, but
      *cancelling* one is deliberately narrower (mirrors `document.archive`
      instead), so a role that can generate/request (e.g. `arranger`)
      doesn't automatically gain cancellation authority too. */
  'signature.request',
  'signature.read',
  'signature.cancel',
  'signature.manage',

  /** Phase 27 (Scheduling & Resource Management). `schedule.*` mirrors
      `document.*`'s own tier split exactly: `.read`/`.create`/`.edit`
      cover the everyday calendar workflow, while `.cancel` is
      deliberately narrower (mirrors `document.archive`/`signature.cancel`)
      so a role that can create/edit an appointment doesn't automatically
      gain cancellation authority. `resource.manage` is a distinct
      resource, not folded into `schedule.*` — creating/editing/disabling
      a Resource (and authorizing a hard-conflict override) is an
      org-wide, administrative action, mirroring
      `document.template.manage`/`signature.manage`'s tier. `calendar.manage`
      is reserved for future org-wide calendar settings (business hours,
      holidays) — no dedicated UI ships this phase, mirroring
      `signature.manage`'s own "reserved, no UI yet" precedent. */
  'schedule.read',
  'schedule.create',
  'schedule.edit',
  'schedule.cancel',
  'resource.manage',
  'calendar.manage',

  /** Phase 28 (Communications & Notifications). `notification.read` gates
      the organization-wide notification log (mirrors `audit.read`'s own
      tier) — never your own personal inbox, which needs no permission at
      all (every authenticated member reads their own notifications, the
      same way every member reads their own session). `notification.send`
      mirrors `document.generate`/`schedule.create`'s tier. `notification.manage`
      (cancel a pending notification; manage notification-related
      settings) mirrors `document.template.manage`/`signature.manage`'s
      narrower tier. `notification.admin` is reserved for a future
      org-wide notification policy surface (default digest settings,
      quiet-hours policy) — no dedicated UI ships this phase, mirroring
      `calendar.manage`'s own "reserved, no UI yet" precedent. */
  'notification.read',
  'notification.send',
  'notification.manage',
  'notification.admin',

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

  'document.generate': 'Generate (or regenerate) a document from a template',
  'document.view': "View and download a case's documents",
  'document.upload': 'Upload a file to a case',
  'document.archive': 'Archive a case document',

  'document.template.read': 'View the organization-wide document template library',
  'document.template.manage': 'Create, edit, duplicate, and archive document templates',

  'signature.request': 'Request or resend an electronic signature for a case document',
  'signature.read': "View a case document's signature status and history",
  'signature.cancel': 'Cancel an active signature request',
  'signature.manage': 'Manage organization-wide electronic signature settings',

  'schedule.read': 'View calendars and appointments',
  'schedule.create': 'Create a new appointment',
  'schedule.edit': 'Reschedule, update, confirm, or complete an appointment',
  'schedule.cancel': 'Cancel an appointment',
  'resource.manage': 'Create, edit, and change the lifecycle status of schedulable resources; authorize a conflict override',
  'calendar.manage': 'Manage organization-wide calendar settings',

  'notification.read': 'View the organization-wide notification log',
  'notification.send': 'Create or broadcast a notification',
  'notification.manage': 'Cancel a pending notification; manage notification-related settings',
  'notification.admin': 'Manage organization-wide notification policy settings',

  'report.view': 'View reports',

  'audit.read': 'View the organization-wide activity and audit log',
  'audit.export': 'Export activity and audit log data',

  'organization.manage': "Manage the organization's own profile and settings",

  'user.invite': 'Invite a new user to the organization',
  'user.remove': "Remove a user from the organization's membership",
  'user.manageRoles': 'Create, edit, and assign roles',

  'settings.manage': "Manage the organization's configuration settings",
};
