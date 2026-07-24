/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The
 * authoritative, itemized pricing record for one case — see
 * docs/adr/ADR-023-case-order-pricing-engine.md. Beacon calculates every
 * total server-side (domain/pricing/calculateOrder.ts,
 * services/pricingService.ts); Clover only ever collects `balanceDue` (see
 * types/payment.ts's PaymentRecord.caseOrderId and
 * app/api/cases/[caseId]/payments/clover/checkout/route.ts).
 *
 * CaseOrder is append-only/versioned, the same pattern already established
 * for WorkflowTemplateVersion: editing a case's services never mutates an
 * existing CaseOrder row — it inserts a new one with `version` incremented
 * and `status: 'superseded'` set on the row it replaces. Exactly one
 * CaseOrder per case ever has `status: 'active'` at a time. This is what
 * makes "Never rewrite historical payments" true structurally: a
 * PaymentRecord's `caseOrderId` always points at whichever version was
 * active when that payment was initiated, and that version's own totals
 * never change after the fact — only a *new* version reflects an edit.
 */
export type CaseOrderStatus = 'active' | 'superseded';

export type CaseOrder = {
  id: string;
  organizationId: string;
  caseId: string;
  status: CaseOrderStatus;
  /** Sum of all line items' lineTotal — integer cents. */
  subtotal: number;
  /** Reserved for a future discount feature (domain/pricing's
      calculateAdjustment) — always 0 today; no UI in this phase produces a
      non-zero value, and "No client-controlled discounts" means it can
      only ever be set server-side once such a feature exists. */
  discountTotal: number;
  /** Reserved for a future tax feature — always 0 today, same reasoning as
      discountTotal. */
  taxTotal: number;
  /** subtotal - discountTotal + taxTotal. */
  total: number;
  /** total minus every 'succeeded' PaymentRecord for this *case* (across
      all CaseOrder versions, not just this one — a payment made against an
      earlier version still counts toward the current version's balance).
      Never negative — see domain/pricing/calculateOrder.ts's
      calculateBalance. */
  balanceDue: number;
  /** 1 for a case's first CaseOrder, incrementing by 1 each edit. */
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CaseOrderLineItem = {
  id: string;
  organizationId: string;
  caseOrderId: string;
  /** References ServiceCatalogItem.serviceCode — never a hardcoded string
      in a component; always sourced from the catalog. */
  serviceCode: string;
  /** Copied from the catalog's displayName at calculation time — a
      historical CaseOrder version keeps reading correctly even if a
      catalog row's displayName changes later. */
  description: string;
  quantity: number;
  /** Integer cents — copied from the catalog at calculation time, same
      historical-stability reasoning as `description`. */
  unitPrice: number;
  /** quantity * unitPrice, integer cents. */
  lineTotal: number;
  sortOrder: number;
  /** Reserved for future line-item-specific data (e.g. which weight tier a
      surcharge line represents) — null in this phase's own writes. */
  metadata: Record<string, string> | null;
  createdAt: string;
};

/**
 * Selections a human makes on the "Services & Charges" UI — never a
 * dollar amount, a total, or a serviceCode's price. The server (never the
 * browser) turns these into CaseOrderLineItems via
 * domain/pricing/calculateOrder.ts, always re-fetching the catalog itself.
 * Mirrors this phase's five seeded Manor's Cremation service codes without
 * hardcoding them here: `weightTier`'s non-'under_200' values and
 * `mailCremated`/`extraDeathCertificateQuantity` are resolved against
 * whatever the organization's actual catalog contains — an org whose
 * catalog lacks a MAIL_CREMATED_REMAINS row simply never gets that line
 * item, no matter what `mailCremated` says.
 */
export type WeightTier = 'under_200' | '201_250' | '251_300';

export type ServiceSelections = {
  weightTier: WeightTier;
  extraDeathCertificateQuantity: number;
  mailCremated: boolean;
};
