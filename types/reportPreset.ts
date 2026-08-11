/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). A saved filter
 * preset for one report — name, owner, organization scope, and a
 * serialized `ReportFilters` (see `services/reportingService.ts`). No
 * scheduled email delivery, no arbitrary query builder — exactly what
 * the phase's own Saved Reports scope calls for and nothing more. See
 * docs/adr/ADR-036-reporting-analytics-executive-dashboard-architecture.md.
 */
export type ReportPreset = {
  id: string;
  organizationId: string;
  reportKey: string;
  name: string;
  /** Identity-space, deliberately — "who saved this for their own
      convenience" is actor-attribution, not an operational assignment,
      so this is never `ownerStaffProfileId` (see ADR-034's own layering
      invariant, which this field is correctly outside of). */
  ownerIdentityId: string;
  /** JSON-serialized `ReportFilters`. */
  filters: string;
  /** Org-wide visible to any caller with the report's own view
      permission, not just the owner. Settable only with `dashboard.manage`
      (enforced at the route/service layer, not here). */
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NewReportPresetInput = {
  reportKey: string;
  name: string;
  filters: string;
  isShared?: boolean;
};
