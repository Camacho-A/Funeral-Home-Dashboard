import type { FtcClass } from './ftcComplianceRegistry';
import type { FtcDisclosure, ProviderOfferings } from './ftcComplianceRegistry';
import type { BillingSupplementalBlock } from '../../types/billingSupplementalConfig';

/**
 * Phase 39 (Family Billing & FTC Compliance). Immutable SNAPSHOT models the
 * pure renderers consume. These are assembled once, at generation time, from
 * authoritative point-in-time data (the exact CaseOrder version, catalog
 * prices, cash advances, disclosure version) — a historical compliance
 * document is NEVER re-derived from today's mutable catalog. The rendered PDF
 * bytes + checksum are the durable snapshot; these models are how it is built.
 */

export type StatementLineItem = {
  ftcClass: FtcClass;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  /** True when this line's price already includes the non-declinable basic
      services fee (D10 — Manor's direct-cremation bundled model). */
  includesBasicServicesFee: boolean;
};

export type StatementCashAdvanceItem = {
  description: string;
  amountCents: number;
  hasMarkup: boolean;
  isEstimated: boolean;
};

/** How the non-declinable basic services fee is represented for this provider. */
export type BasicServicesFeeMode = 'included_in_priced_service' | 'separately_charged';

export type ProviderIdentity = {
  name: string;
  addressLine: string;
  phone: string;
};

export type BillingStatementModel = {
  provider: ProviderIdentity;
  decedentName: string;
  caseNumber: string;
  dateOfDeath: string | null;
  generatedAt: string;
  /** The exact CaseOrder.version this statement itemizes (provenance). */
  orderVersion: number;
  disclosureVersion: string;
  supplementalVersion: number;

  /** Funeral-home goods/services lines (from the authoritative CaseOrder). */
  lineItems: StatementLineItem[];
  basicServicesFeeMode: BasicServicesFeeMode;

  /** === AUTHORITATIVE ACCOUNTING FIGURES (from CaseOrder + payments) === */
  /** CaseOrder.total — the GL/AR-authoritative charge for funeral-home goods/services. */
  goodsAndServicesTotalCents: number;
  /** Payments applied to date (succeeded), across all order versions. */
  paidToDateCents: number;
  /** CaseOrder.balanceDue — the AUTHORITATIVE Accounts Receivable balance.
      Does NOT include cash advances (D4). */
  authoritativeArBalanceDueCents: number;

  /** === FTC-STATEMENT-ONLY FIGURES (display; NOT accounting) === */
  cashAdvanceItems: StatementCashAdvanceItem[];
  /** Sum of cash advances — display-only, never an accounting figure. */
  cashAdvanceSubtotalCents: number;
  /** FTC "total cost of arrangements" = goods/services total + cash advances.
      This is a compliance display total, explicitly NOT the AR balance due. */
  ftcStatementTotalCents: number;

  /** Optional provider-entered explanation of any legally/cemetery/crematory
      required purchases (org-configurable per arrangement). */
  requiredPurchaseExplanations: string | null;

  offerings: ProviderOfferings;
  disclosures: FtcDisclosure[];
  supplementalBlocks: BillingSupplementalBlock[];
};

export type GplServiceLine = {
  category: string;
  displayName: string;
  priceCents: number;
  ftcClass: FtcClass;
  includesBasicServicesFee: boolean;
};

export type GplMerchandiseLine = {
  category: string;
  name: string;
  priceCents: number;
};

export type GeneralPriceListModel = {
  provider: ProviderIdentity;
  effectiveDate: string;
  generatedAt: string;
  disclosureVersion: string;
  supplementalVersion: number;
  serviceLines: GplServiceLine[];
  merchandiseLines: GplMerchandiseLine[];
  offerings: ProviderOfferings;
  disclosures: FtcDisclosure[];
  supplementalBlocks: BillingSupplementalBlock[];
};
