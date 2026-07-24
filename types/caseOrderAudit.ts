/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Immutable audit
 * trail for edits to a case's services — distinct from CaseOrder's own
 * version history (which records *what the order was*), this records *who
 * changed it, when, and why the total moved*. Never updated once written;
 * services/pricingService.ts only ever appends.
 *
 * `action`/`previousValue`/`newValue` are plain strings (not a closed
 * union or numeric diff) so a future pricing rule this phase doesn't
 * anticipate can still produce a legible audit row without a type change.
 * `description` is the single precomposed human-readable line — e.g.
 * "Changed: Weight, Under 200 lb -> 201-250 lb, +$290" — matching the
 * exact format the phase's own spec examples used, so Case Detail/Print
 * Order can render it directly with no further formatting logic.
 */
export type CaseOrderAuditEntry = {
  id: string;
  organizationId: string;
  caseId: string;
  /** The CaseOrder version this entry's change resulted in — null only for
      a hypothetical future entry not tied to a specific version (none
      today; every entry this phase writes has one). */
  caseOrderId: string;
  /** Short machine-stable category — e.g. 'order_created',
      'weight_tier_changed', 'death_certificate_quantity_changed',
      'mail_cremated_remains_added', 'mail_cremated_remains_removed'. */
  action: string;
  previousValue: string | null;
  newValue: string | null;
  /** Signed integer cents this single change moved the total by (0 for
      the initial 'order_created' entry, which has nothing to compare
      against). */
  amountDeltaCents: number;
  description: string;
  /** The staff member's display name at the time of the edit — sourced
      from the trusted session server-side (see useSession()), never a
      client-supplied string, matching Case's own createdBy/intakeOwnerId
      trust model. */
  performedBy: string;
  createdAt: string;
};
