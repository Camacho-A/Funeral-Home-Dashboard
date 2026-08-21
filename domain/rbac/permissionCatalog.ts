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
      — reserved since Phase 27 — gets its first real use in Phase 34
      (Scheduling Integrations, Calendar Sync & Automated Reminders):
      org-wide oversight of every staff member's calendar connection
      (view/force-disconnect) and configuring the organization's
      `SchedulingReminderPolicy`. A staff member connecting/disconnecting
      their OWN calendar needs no permission beyond authentication —
      only the org-wide oversight surface is gated by this key. Business
      hours/holiday settings remain a plausible future use of this same
      key, not a separate one, if ever built. */
  'schedule.read',
  'schedule.create',
  'schedule.edit',
  'schedule.cancel',
  'resource.manage',
  'calendar.manage',

  /** Phase 30 (Identity Model Hardening & Staff Assignment Unification).
      A distinct `task` resource — gates reassigning a `CaseTask.assigneeStaffId`
      (via `assertAssignableStaffProfile`), mirroring `schedule.edit`'s own
      tier exactly (every role except `accounting`/`readOnly`). Case-level
      and appointment-owner assignment reuse the existing `case.update`/
      `schedule.edit` keys respectively — this key exists only because task
      assignment has no other permission of its own to piggyback on. */
  'task.assign',

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

  /** Phase 29 (Family Portal & External Collaboration). Both are staff-side
      only — they govern whether a staff member can invite/manage family
      Portal Users and revoke their access (`portal.manage`, mirrors
      `document.template.manage`/`signature.manage`'s administrative tier)
      or send/read case-scoped messages to family Portal Users
      (`portal.message`, mirrors `notification.send`'s everyday tier).
      Neither key is ever checked by any family-side route — the Family
      Portal has its own, fully separate `PortalCapabilityKey` policy
      (`domain/portal/portalCapabilityPolicy.ts`); these two exist purely
      to gate the staff-facing `CaseFamilyPortalTab`. */
  'portal.manage',
  'portal.message',

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

  /** Phase 31 (Financial Management & General Ledger). One coarse-grained
      `accounting` resource covering the whole financial domain (chart of
      accounts, general ledger, banking, reconciliation, reports) —
      deliberately not split into fine-grained `<entity>.<verb>` keys the
      way every other resource in this catalog is (`schedule.*`,
      `document.*`, etc.). See docs/adr/ADR-035-financial-management-and-general-ledger.md's
      "Permissions" section for why this one domain is consolidated rather
      than following that convention. `.view` covers read-only access
      across chart of accounts/ledger/banking/AR; `.manage` covers
      chart-of-accounts CRUD and write-offs/adjustments/non-posting
      configuration; `.post` covers posting or voiding a journal entry or
      financial transaction — deliberately separate from `.manage`,
      mirroring `schedule.edit`/`schedule.cancel`'s own tier split, so a
      role that can prepare a manual entry doesn't automatically gain
      authority to post it; `.reconcile` covers the bank reconciliation
      workflow specifically; `.report` covers the six financial reports. */
  'accounting.view',
  'accounting.manage',
  'accounting.post',
  'accounting.reconcile',
  'accounting.report',

  /** Phase 32 (Reporting, Analytics & Executive Dashboard). `report.view`
      (existing, Phase 20) remains the base "can see Reports/Dashboard at
      all" gate. `report.operational` covers the new operational metric
      catalog (cases/tasks/appointments/resources/documents/signatures) —
      financial report access is deliberately unchanged, still gated by
      the existing `accounting.report`, not a new duplicate key.
      `report.staff` is narrower still, mirroring `document.template.manage`'s
      "administrative tier" pattern for anything that surfaces per-staff-
      member workload data. `report.export` mirrors `audit.export`'s own
      narrower-than-read precedent: exporting a report requires this key
      *in addition to* the report's own view permission, never instead of
      it. `dashboard.manage` gates managing organization-wide shared
      report presets — it does not gate viewing the dashboard itself. */
  'report.operational',
  'report.staff',
  'report.export',
  'dashboard.manage',

  /** Phase 35 (Merchandise, Inventory & Commerce). Five keys, following the
      accounting-block precedent of a small, coarse resource set rather than
      a fine-grained verb-per-operation cluster. `merchandise.read`/`.manage`
      gate the product catalog (view vs create/edit/archive/image).
      `inventory.read` gates stock views/reports; `inventory.manage` gates
      the everyday stock operations (receive, reserve, release, fulfill,
      transfer, restock-return); `inventory.adjust` is the higher-privilege,
      always-audited gate for damage/shrinkage/write-off/correction — the
      one operation that can reduce recorded stock without a corresponding
      sale. Selecting merchandise onto a case reuses the existing
      `caseOrder.update` (it is a CaseOrder mutation), not a new key. See
      docs/adr/ADR-039-merchandise-inventory-and-commerce.md. */
  'merchandise.read',
  'merchandise.manage',
  'inventory.read',
  'inventory.manage',
  'inventory.adjust',
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
  'calendar.manage': 'Oversee staff calendar connections and configure the organization’s appointment reminder policy',

  'task.assign': 'Assign or reassign a task to a staff member',

  'notification.read': 'View the organization-wide notification log',
  'notification.send': 'Create or broadcast a notification',
  'notification.manage': 'Cancel a pending notification; manage notification-related settings',
  'notification.admin': 'Manage organization-wide notification policy settings',

  'portal.manage': "Invite, manage, and revoke a case's Family Portal access",
  'portal.message': 'Send and read Family Portal messages for a case',

  'report.view': 'View reports',

  'audit.read': 'View the organization-wide activity and audit log',
  'audit.export': 'Export activity and audit log data',

  'organization.manage': "Manage the organization's own profile and settings",

  'user.invite': 'Invite a new user to the organization',
  'user.remove': "Remove a user from the organization's membership",
  'user.manageRoles': 'Create, edit, and assign roles',

  'settings.manage': "Manage the organization's configuration settings",

  'accounting.view': 'View the chart of accounts, general ledger, banking, and accounts receivable',
  'accounting.manage': 'Manage the chart of accounts and post write-offs/adjustments',
  'accounting.post': 'Post or void a journal entry or financial transaction',
  'accounting.reconcile': 'Perform bank statement reconciliation',
  'accounting.report': 'View financial reports (Trial Balance, Balance Sheet, Profit & Loss, AR Aging, Transaction Register)',

  'report.operational': 'View operational reports (cases, tasks, appointments, resources, documents, signatures)',
  'report.staff': 'View staff workload and ownership reports',
  'report.export': 'Export a report to CSV',
  'dashboard.manage': 'Manage organization-wide shared report presets',

  'merchandise.read': 'View the merchandise product catalog',
  'merchandise.manage': 'Create, edit, archive, and set images for merchandise products',
  'inventory.read': 'View inventory stock levels, movements, and inventory reports',
  'inventory.manage': 'Receive, reserve, fulfill, transfer, and restock-return merchandise inventory',
  'inventory.adjust': 'Record audited inventory adjustments — damage, shrinkage, write-off, and count corrections',
};
