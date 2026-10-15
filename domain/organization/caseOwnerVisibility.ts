/**
 * Task #17 (2026-09, hide Case Owner for Manors). Manors is a small
 * collaborative operation that does not use individual case ownership —
 * staff accountability there comes from Case Activity's own actor-
 * resolution (Task #9/#10), not from a persistent "who owns this case"
 * display. This is a presentation-only decision for one organization:
 * `Case.assignedStaffId` itself, its persistence, its use in task default-
 * assignee derivation (domain/tasks/rules.ts), notification recipient
 * resolution (services/notifications/recipientResolver.ts), and Reports
 * "my cases" filtering (domain/reports/calculations.ts,
 * services/reportingService.ts) are all untouched — every one of those
 * still reads/writes the real field exactly as before. Only the Owner
 * *editor* in Case Information is hidden for this one organization.
 *
 * 2026-10: resolved through the organization profile
 * (`features.caseOwnerVisible`, domain/organization/organizationProfiles.ts)
 * rather than a hardcoded id. Manors: hidden. Every other organization
 * keeps the existing Owner field exactly as it already works.
 */
import { getRegisteredOrganizationProfile } from './organizationProfiles';

/** 2026-10: now a profile preference (`features.caseOwnerVisible`, see
    domain/organization/organizationProfiles.ts) rather than a hardcoded id. */
export function shouldShowCaseOwner(organizationId: string): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.caseOwnerVisible;
}
