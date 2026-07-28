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

export function canDeleteCase(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'case.delete');
}

export function canEditCaseOrder(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'caseOrder.update');
}

export function canEditWorkflow(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'workflow.edit');
}

export function canPublishWorkflow(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'workflow.publish');
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

export function canGenerateDocument(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'document.generate');
}

export function canViewReports(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  return hasPermission(params, dataAdapterMode, 'report.view');
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
