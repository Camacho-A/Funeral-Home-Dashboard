import type { DataAdapterMode } from '../lib/env';
import { hasPermission, hasAnyPermission, type ResolvePermissionsParams } from './permissionService';

/**
 * Phase 22 (Role-Based Access Control). The "Authorization Policy ->
 * Business Operation" step of the phase spec's flow diagram — the *only*
 * layer any business service or Route Handler should call to answer "may
 * this identity do X." Every function here composes one or more
 * permission checks; none ever compares a role name. Adding a new policy
 * is always a new named function here, never an inline
 * `role === '...'` at the call site.
 */

export function canReadCases(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'case.read');
}

export function canCreateCase(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'case.create');
}

export function canEditCase(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'case.update');
}

/** Manors go-live fix. Narrower than `canEditCase` — gates assigning a
    case's handler to a staff member OTHER than the caller themselves.
    Assigning a case to yourself never needs this (see the call sites in
    app/api/cases/route.ts and app/api/cases/[caseId]/route.ts). */
export function canReassignCase(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'case.reassign');
}

export function canDeleteCase(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'case.delete');
}

/** Manors launch-prep (Dispatch role). A narrower alternative to
    `canReadCases`/`canEditCase` — grants a redacted pickup-only view/edit
    of a case (decedent name, case number, pickup fields) without the
    full `case.read`/`case.update` a Dispatch caller must never hold. See
    `pickup.read`/`pickup.update`'s own catalog comment. */
export function canReadPickup(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'pickup.read');
}

export function canUpdatePickup(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'pickup.update');
}

export function canEditCaseOrder(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'caseOrder.update');
}

/** Manors launch-prep — additional case charges. `caseOrder.read` is
    deliberately broader than `payment.read` below: viewing/selecting a
    case's operational services and add-ons (what's on the order) is core
    case-working, held by every default role that manages cases; viewing
    the case's TOTAL/BALANCE/payment-history is the narrower financial
    concern `canReadPayment` alone gates. See CaseOrderCard.tsx's own
    comment on how these two combine. */
export function canReadCaseOrder(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'caseOrder.read');
}

export function canEditWorkflow(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'workflow.edit');
}

export function canPublishWorkflow(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'workflow.publish');
}

/** Manors launch-prep: `payment.read` was already in the permission catalog
    and already granted to the appropriate default roles, but nothing ever
    checked it — case total/balance/payment-history reads were gated only
    by case-view access. This closes that gap without adding a new key. */
export function canReadPayment(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'payment.read');
}

export function canCollectPayment(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'payment.collect');
}

export function canRefundPayment(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'payment.refund');
}

export function canEditServiceCatalog(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'serviceCatalog.edit');
}

/** Phase 22 declared `document.generate`; Phase 25 (Document Generation &
    Template Management) is what finally gives it a real route/call site
    (this function itself, unchanged, was already dead code until now). */
export function canGenerateDocument(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'document.generate');
}

/** Phase 25. Gates viewing/downloading a case's documents — same
    "finally wired" history as `canGenerateDocument` above. */
export function canViewDocument(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'document.view');
}

export function canUploadDocument(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'document.upload');
}

export function canArchiveDocument(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'document.archive');
}

/** Gates the org-wide Document Template Library — distinct from the
    case-scoped document.* policies above, mirroring
    `canReadAuditLog`/`canExportAuditLog`'s own read/manage split. */
export function canReadDocumentTemplate(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'document.template.read');
}

export function canManageDocumentTemplate(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'document.template.manage');
}

/** Phase 26 (Electronic Signatures & Authorization Workflows). A distinct
    `signature` resource, not folded into the document.* policies above —
    see `domain/rbac/permissionCatalog.ts`'s own comment for why. */
export function canRequestSignature(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'signature.request');
}

export function canReadSignature(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'signature.read');
}

export function canCancelSignature(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'signature.cancel');
}

export function canManageSignature(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'signature.manage');
}

/** Phase 27 (Scheduling & Resource Management). `schedule.*` mirrors
    `document.*`'s own tier split exactly; `resource.manage`/
    `calendar.manage` are distinct resources, not folded into `schedule.*`
    — see `domain/rbac/permissionCatalog.ts`'s own comment for why. */
export function canReadSchedule(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'schedule.read');
}

export function canCreateAppointment(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'schedule.create');
}

export function canEditAppointment(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'schedule.edit');
}

export function canCancelAppointment(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'schedule.cancel');
}

export function canManageResources(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'resource.manage');
}

export function canManageCalendar(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'calendar.manage');
}

/** Phase 28 (Communications & Notifications). `notification.read` gates
    only the organization-wide notification log — a caller's own personal
    inbox (list/mark-read/archive/preferences) needs no permission check
    at all, since every authenticated member may always read and manage
    their own notifications. */
export function canReadNotifications(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'notification.read');
}

export function canSendNotification(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'notification.send');
}

export function canManageNotifications(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'notification.manage');
}

export function canAdminNotifications(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'notification.admin');
}

/** Phase 29 (Family Portal & External Collaboration). Staff-side only —
    gates inviting/revoking a case's Family Portal access
    (`CaseFamilyPortalTab`'s management controls). Never checked by any
    family-side route; those are gated exclusively by
    `hasPortalCapability` (`domain/portal/portalCapabilityPolicy.ts`). */
export function canManagePortal(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'portal.manage');
}

export function canSendPortalMessage(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'portal.message');
}

export function canViewReports(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'report.view');
}

/** Phase 24 (Case Activity Timeline & Audit Center). Gates the org-wide,
    cross-case Audit Center — not an individual case's Activity tab, which
    reuses `canReadCases` instead (see ADR-028: no role can read a case's
    data but not its history, so a separate case-scoped audit permission
    would be a distinction with no real difference). */
export function canReadAuditLog(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'audit.read');
}

export function canExportAuditLog(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'audit.export');
}

export function canManageOrganization(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'organization.manage');
}

export function canInviteUser(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'user.invite');
}

export function canRemoveUser(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'user.remove');
}

/** Governs role management itself — creating/cloning/updating/deleting
    roles and assigning/removing them from members. `RoleService` calls
    this before any mutating operation; no route ever checks
    `user.manageRoles` directly. */
export function canManageRoles(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'user.manageRoles');
}

export function canManageSettings(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'settings.manage');
}

/** Phase 31 (Financial Management & General Ledger). Read-only access
    across chart of accounts, general ledger, banking, and accounts
    receivable. */
export function canReadFinancials(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'accounting.view');
}

/** Chart-of-accounts CRUD and write-offs/adjustments/non-posting
    configuration — deliberately separate from `canPostJournalEntry`, so a
    role that can prepare a manual entry doesn't automatically gain
    authority to post it (mirrors `canEditAppointment`/`canCancelAppointment`'s
    own tier split). */
export function canManageFinancials(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'accounting.manage');
}

/** Posting or voiding a journal entry or financial transaction — the
    irreversible action. */
export function canPostJournalEntry(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'accounting.post');
}

export function canReconcileBank(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'accounting.reconcile');
}

/** The six financial reports (Trial Balance, General Ledger, Balance
    Sheet, Profit & Loss, AR Aging, Transaction Register) — deliberately a
    distinct key from the pre-existing `report.view` (which gates the
    operational Reports page), so an organization can grant financial
    report access independently of operational reporting access. */
export function canViewFinancialReports(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'accounting.report');
}

/** Phase 32 (Reporting, Analytics & Executive Dashboard). Operational
    reports (cases, tasks, appointments, resources, documents,
    signatures) — a distinct key from both `report.view` (the base
    "can see Reports/Dashboard at all" gate) and `accounting.report`
    (financial reports, deliberately not broadened by this phase). */
export function canViewOperationalReports(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'report.operational');
}

/** Staff workload/ownership reports — narrower than operational
    reporting in general, mirroring `document.template.manage`'s own
    administrative tier. */
export function canViewStaffReports(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'report.staff');
}

/** Exporting a report to CSV — required *in addition to* the report's own
    view permission, never instead of it (mirrors `audit.export`'s own
    narrower-than-read precedent). Callers must still separately check the
    report's own view policy before calling this. */
export function canExportReports(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'report.export');
}

/** Managing organization-wide shared report presets — does not gate
    viewing the dashboard itself, only saving/removing a preset with
    `isShared: true`. */
export function canManageDashboard(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'dashboard.manage');
}

/**
 * "Admin-tier" in the pre-Phase-22 sense (owner/administrator): full
 * organization management authority. Preserved as a named policy — not a
 * role comparison — specifically so `lib/auth/authorize.ts`'s
 * `hasAdminTierMembership` and `services/organizationProvisioningService.ts`'s
 * `countAdminMemberships` (both migrated in this phase) have a single
 * shared definition of "counts as an administrator" that can never drift
 * between the two call sites.
 */
export function isAdminTier(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return canManageOrganization(params, dataAdapterMode);
}

/** True if any of the given permissions is held — used by UI-gating hooks
    that need to show a control if the user can do *either* of two related
    things (e.g. show a "Payments" tab if the user can read OR collect). */
export function hasAnyOfPolicies(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode, permissions: Parameters<typeof hasAnyPermission>[2]): Promise<boolean> {
  return hasAnyPermission(params, dataAdapterMode, permissions);
}

// Phase 35 (Merchandise, Inventory & Commerce). One-line policy wrappers,
// following the exact existing pattern — never a role-name comparison.
export function canReadMerchandise(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'merchandise.read');
}
export function canManageMerchandise(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'merchandise.manage');
}
export function canReadInventory(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'inventory.read');
}
export function canManageInventory(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'inventory.manage');
}
export function canAdjustInventory(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'inventory.adjust');
}

// Phase 36 (Procurement & Accounts Payable). `ap.pay` is deliberately a
// separate policy from `ap.manage` (segregation of duties: enter vs disburse).
export function canReadProcurement(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'procurement.read');
}
export function canManageProcurement(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'procurement.manage');
}
export function canReadAccountsPayable(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'ap.read');
}
export function canManageAccountsPayable(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'ap.manage');
}
export function canPayAccountsPayable(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'ap.pay');
}
