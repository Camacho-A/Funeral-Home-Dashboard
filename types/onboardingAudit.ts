/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Immutable audit
 * trail for onboarding/provisioning actions — organization created,
 * administrator assigned, workflow provisioned, catalog seeded, payment
 * placeholder created, onboarding completed. Structurally the same
 * pattern already established by `types/caseOrderAudit.ts`'s
 * `CaseOrderAuditEntry` (organizationId/actorId/action/timestamp/
 * metadata) — a genuinely separate collection rather than a literal reuse
 * of that type, since `CaseOrderAuditEntry` requires a non-nullable
 * `caseId`/`caseOrderId` that has no meaning at the organization-
 * provisioning level. See ADR-024's "Reusing the audit architecture, not
 * the collection" section.
 */
export type OnboardingAuditEntry = {
  id: string;
  organizationId: string;
  actorUserId: string;
  /** Plain string, not a closed union — e.g. `organization_created`,
      `administrator_assigned`, `workflow_provisioned`,
      `service_catalog_seeded`, `payment_integration_placeholder_created`,
      `onboarding_completed`. Open-ended so a future provisioning step
      never needs a type change to log its own action. */
  action: string;
  /** Non-secret, display-safe key/value context only — e.g.
      `{ templateSource: 'starter' }` or `{ provider: 'clover' }`. Never a
      credential value, env var value, or anything from
      lib/paymentFieldGuard.ts's forbidden-field list; enforced by
      services/organizationProvisioningService.ts only ever constructing
      this from values it already knows are safe, never passing through an
      arbitrary caller-supplied object. */
  metadata: Record<string, string> | null;
  timestamp: string;
};
