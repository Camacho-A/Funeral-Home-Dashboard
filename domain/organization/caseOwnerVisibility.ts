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
 * Same hardcoded-organization-ID pattern every other Manors-specific UI
 * decision in this codebase already uses (see
 * domain/organization/caseOrderTerminology.ts's own identical comment) —
 * deliberately not a new org-level feature-flag system for what is, today,
 * a single customer's presentation preference. Other organizations may
 * need individual case assignment and keep the existing Owner field
 * exactly as it already works.
 */
const MANORS_ORGANIZATION_ID = 'managed-cremations';

export function shouldShowCaseOwner(organizationId: string): boolean {
  return organizationId !== MANORS_ORGANIZATION_ID;
}
