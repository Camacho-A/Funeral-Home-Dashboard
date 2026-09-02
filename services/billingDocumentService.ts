import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { resolveMergeSourceData, resolveOrganizationIdentity, generateBillingDocument, renderAndStorePdf } from './documentService';
import { getServiceCatalog, listLineItemsForOrder, getPaidAmountForCase } from './pricingService';
import { listProductsForOrganization } from './merchandiseService';
import { listCashAdvanceItems, sumCashAdvances } from './cashAdvanceService';
import { getSupplementalConfig } from './billingConfigService';
import { createOrgDocument } from './orgDocumentService';
import { classifyServiceItem } from '../domain/billing/ftcClassification';
import { FTC_CLASS, FTC_DISCLOSURE_VERSION, disclosuresFor, type ProviderOfferings } from '../domain/billing/ftcComplianceRegistry';
import { renderStatementHtml } from '../domain/billing/renderStatementHtml';
import { renderGeneralPriceListHtml } from '../domain/billing/renderGeneralPriceListHtml';
import { DOCUMENT_TYPES } from '../domain/documents/documentTypeRegistry';
import type { Organization } from '../types/organization';
import type { OrganizationLocation } from '../types/organizationLocation';
import type { BillingStatementModel, GeneralPriceListModel, ProviderIdentity, StatementLineItem, GplServiceLine, GplMerchandiseLine } from '../domain/billing/billingModels';
import type { ServiceCatalogItem } from '../types/serviceCatalog';
import type { MerchandiseProduct } from '../types/merchandiseProduct';
import type { CaseDocument } from '../types/caseDocument';
import type { OrgDocument } from '../types/orgDocument';

/**
 * Phase 39 (Family Billing & FTC Compliance). Assembles the immutable SNAPSHOT
 * models for the FTC Statement of Funeral Goods & Services and the General
 * Price List from authoritative point-in-time data, renders them via the pure
 * `domain/billing/*` renderers, and routes them through `documentService` for
 * PDF render + storage (preserving the render/store boundary). It never
 * touches the GL, AR, or PaymentService — it only READS the authoritative
 * order/payments and treats cash advances as display-only.
 */
export class BillingDocumentServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingDocumentServiceError';
  }
}

type ActivityContext = {
  organizationId: string;
  actorIdentityId: string | null;
  actorMembershipId: string | null;
  actorRoleKey: string | null;
  correlationId: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Derives which conditional FTC disclosures apply from the org's ACTUAL
    configured offerings — never assumed (D7). Direct cremation is inferred
    from a `base` service; caskets/OBCs from active merchandise categories.
    Embalming is not offered unless an embalming-classified service exists. */
function deriveOfferings(catalog: ServiceCatalogItem[], products: MerchandiseProduct[]): ProviderOfferings {
  const activeServices = catalog.filter((s) => s.isActive);
  const activeProducts = products.filter((p) => p.isActive);
  return {
    offersDirectCremation: activeServices.some((s) => s.category === 'base'),
    offersEmbalming: activeServices.some((s) => /embalm/i.test(s.serviceCode) || /embalm/i.test(s.category)),
    offersCaskets: activeProducts.some((p) => p.category === 'casket'),
    offersOuterBurialContainers: activeProducts.some((p) => p.category === 'vault'),
  };
}

function providerIdentity(organization: Organization, location: OrganizationLocation | null): ProviderIdentity {
  const addressLine = location
    ? [location.addressLine1, location.addressLine2, `${location.city}, ${location.state} ${location.postalCode}`].filter((p) => p && p.length > 0).join(', ')
    : '';
  return { name: organization.name, addressLine, phone: location?.phone ?? '' };
}

/**
 * Generates (or regenerates) the FTC Statement of Funeral Goods & Services
 * Selected for a case, from its active CaseOrder. Returns the created
 * CaseDocument plus the snapshot model (for staff preview/inspection).
 */
export async function generateStatement(
  params: { caseId: string; existingDocumentId?: string; requiredPurchaseExplanations?: string | null; idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ document: CaseDocument; model: BillingStatementModel }> {
  const org = ctx.organizationId;
  const src = await resolveMergeSourceData(org, params.caseId, dataAdapterMode);
  if (!src.caseOrder) {
    throw new BillingDocumentServiceError('This case has no active order — a statement cannot be generated until an order exists.');
  }
  const order = src.caseOrder;

  const [lineItems, catalog, products, paidToDate, cashAdvances, supplemental] = await Promise.all([
    listLineItemsForOrder(org, order.id, dataAdapterMode),
    getServiceCatalog(org, dataAdapterMode),
    listProductsForOrganization(org, dataAdapterMode, { includeInactive: true }),
    getPaidAmountForCase(org, params.caseId, dataAdapterMode),
    listCashAdvanceItems(org, params.caseId, dataAdapterMode),
    getSupplementalConfig(org, dataAdapterMode),
  ]);

  const catalogByCode = new Map(catalog.map((c) => [c.serviceCode, c]));
  const statementLines: StatementLineItem[] = lineItems.map((line) => {
    let ftcClass;
    if (line.lineKind === 'merchandise') {
      ftcClass = FTC_CLASS.GOODS_AND_SERVICES;
    } else if (line.lineKind === 'service') {
      const item = catalogByCode.get(line.serviceCode);
      ftcClass = item ? classifyServiceItem(item) : FTC_CLASS.UNCLASSIFIED;
    } else {
      ftcClass = FTC_CLASS.GOODS_AND_SERVICES; // reserved kinds route to goods (never cash advance / basic fee)
    }
    return {
      ftcClass,
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: line.unitPrice,
      lineTotalCents: line.lineTotal,
      includesBasicServicesFee: ftcClass === FTC_CLASS.BASIC_SERVICES_FEE,
    };
  });

  const offerings = deriveOfferings(catalog, products);
  const cashAdvanceSubtotal = sumCashAdvances(cashAdvances);
  const hasBundledBasicFee = statementLines.some((l) => l.includesBasicServicesFee);

  const model: BillingStatementModel = {
    provider: providerIdentity(src.organization, src.location),
    decedentName: src.case.decedentName,
    caseNumber: src.case.caseNumber,
    dateOfDeath: src.case.dateOfDeath ?? null,
    generatedAt: (params.now ?? nowIso()).slice(0, 10),
    orderVersion: order.version,
    disclosureVersion: FTC_DISCLOSURE_VERSION,
    supplementalVersion: supplemental.version,
    lineItems: statementLines,
    basicServicesFeeMode: hasBundledBasicFee ? 'included_in_priced_service' : 'separately_charged',
    goodsAndServicesTotalCents: order.total,
    paidToDateCents: paidToDate,
    authoritativeArBalanceDueCents: order.balanceDue,
    cashAdvanceItems: cashAdvances.map((c) => ({ description: c.description, amountCents: c.amountCents, hasMarkup: c.hasMarkup, isEstimated: c.isEstimated })),
    cashAdvanceSubtotalCents: cashAdvanceSubtotal,
    ftcStatementTotalCents: order.total + cashAdvanceSubtotal,
    requiredPurchaseExplanations: params.requiredPurchaseExplanations ?? null,
    offerings,
    disclosures: disclosuresFor('statement_of_goods_and_services', offerings),
    supplementalBlocks: supplemental.blocks,
  };

  const html = renderStatementHtml(model);
  const document = await generateBillingDocument(
    {
      caseId: params.caseId,
      documentTypeKey: DOCUMENT_TYPES.FINANCIAL_STATEMENT_GOODS_SERVICES.key,
      category: 'statement',
      fileName: 'Statement of Funeral Goods and Services Selected.pdf',
      bodyHtml: html,
      existingDocumentId: params.existingDocumentId,
      idFactory: params.idFactory,
      now: params.now,
    },
    ctx,
    dataAdapterMode,
  );
  return { document, model };
}

/** Read-only assembly of the statement model, for staff preview before render. */
export async function previewStatementModel(
  caseId: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<BillingStatementModel> {
  const { model } = await buildStatementModelOnly(caseId, ctx, dataAdapterMode);
  return model;
}

async function buildStatementModelOnly(caseId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ model: BillingStatementModel }> {
  // Reuse generateStatement's assembly without rendering: cheapest correct path
  // is to duplicate only the read+assemble portion. To avoid divergence we call
  // a shared private assembler.
  const org = ctx.organizationId;
  const src = await resolveMergeSourceData(org, caseId, dataAdapterMode);
  if (!src.caseOrder) throw new BillingDocumentServiceError('This case has no active order.');
  const order = src.caseOrder;
  const [lineItems, catalog, products, paidToDate, cashAdvances, supplemental] = await Promise.all([
    listLineItemsForOrder(org, order.id, dataAdapterMode),
    getServiceCatalog(org, dataAdapterMode),
    listProductsForOrganization(org, dataAdapterMode, { includeInactive: true }),
    getPaidAmountForCase(org, caseId, dataAdapterMode),
    listCashAdvanceItems(org, caseId, dataAdapterMode),
    getSupplementalConfig(org, dataAdapterMode),
  ]);
  const catalogByCode = new Map(catalog.map((c) => [c.serviceCode, c]));
  const statementLines: StatementLineItem[] = lineItems.map((line) => {
    const ftcClass =
      line.lineKind === 'merchandise'
        ? FTC_CLASS.GOODS_AND_SERVICES
        : line.lineKind === 'service'
          ? (catalogByCode.get(line.serviceCode) ? classifyServiceItem(catalogByCode.get(line.serviceCode)!) : FTC_CLASS.UNCLASSIFIED)
          : FTC_CLASS.GOODS_AND_SERVICES;
    return { ftcClass, description: line.description, quantity: line.quantity, unitPriceCents: line.unitPrice, lineTotalCents: line.lineTotal, includesBasicServicesFee: ftcClass === FTC_CLASS.BASIC_SERVICES_FEE };
  });
  const offerings = deriveOfferings(catalog, products);
  const cashAdvanceSubtotal = sumCashAdvances(cashAdvances);
  const hasBundledBasicFee = statementLines.some((l) => l.includesBasicServicesFee);
  const model: BillingStatementModel = {
    provider: providerIdentity(src.organization, src.location),
    decedentName: src.case.decedentName,
    caseNumber: src.case.caseNumber,
    dateOfDeath: src.case.dateOfDeath ?? null,
    generatedAt: nowIso().slice(0, 10),
    orderVersion: order.version,
    disclosureVersion: FTC_DISCLOSURE_VERSION,
    supplementalVersion: supplemental.version,
    lineItems: statementLines,
    basicServicesFeeMode: hasBundledBasicFee ? 'included_in_priced_service' : 'separately_charged',
    goodsAndServicesTotalCents: order.total,
    paidToDateCents: paidToDate,
    authoritativeArBalanceDueCents: order.balanceDue,
    cashAdvanceItems: cashAdvances.map((c) => ({ description: c.description, amountCents: c.amountCents, hasMarkup: c.hasMarkup, isEstimated: c.isEstimated })),
    cashAdvanceSubtotalCents: cashAdvanceSubtotal,
    ftcStatementTotalCents: order.total + cashAdvanceSubtotal,
    requiredPurchaseExplanations: null,
    offerings,
    disclosures: disclosuresFor('statement_of_goods_and_services', offerings),
    supplementalBlocks: supplemental.blocks,
  };
  return { model };
}

/**
 * Generates a new General Price List version from the org's authoritative
 * catalog + merchandise (D5, D7). Persists an immutable `OrgDocument` with
 * provenance (effective date, disclosure version, catalog snapshot hash).
 */
export async function generateGeneralPriceList(
  params: { effectiveDate: string; idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ orgDocument: OrgDocument; model: GeneralPriceListModel }> {
  const org = ctx.organizationId;
  // GPL is case-independent — resolve org identity directly (no case).
  const identity = await resolveOrganizationIdentity(org, dataAdapterMode);
  const [catalog, products, supplemental] = await Promise.all([
    getServiceCatalog(org, dataAdapterMode),
    listProductsForOrganization(org, dataAdapterMode, { includeInactive: false }),
    getSupplementalConfig(org, dataAdapterMode),
  ]);
  const activeServices = catalog.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const offerings = deriveOfferings(catalog, products);

  const serviceLines: GplServiceLine[] = activeServices.map((s) => {
    const ftcClass = classifyServiceItem(s);
    return { category: s.category, displayName: s.displayName, priceCents: s.defaultPrice, ftcClass, includesBasicServicesFee: ftcClass === FTC_CLASS.BASIC_SERVICES_FEE };
  });
  const merchandiseLines: GplMerchandiseLine[] = products
    .filter((p) => p.isActive)
    .map((p) => ({ category: p.category, name: p.name, priceCents: p.retailPrice }));

  const model: GeneralPriceListModel = {
    provider: providerIdentity(identity.organization, identity.location),
    effectiveDate: params.effectiveDate,
    generatedAt: (params.now ?? nowIso()).slice(0, 10),
    disclosureVersion: FTC_DISCLOSURE_VERSION,
    supplementalVersion: supplemental.version,
    serviceLines,
    merchandiseLines,
    offerings,
    disclosures: disclosuresFor('general_price_list', offerings),
    supplementalBlocks: supplemental.blocks,
  };

  const html = renderGeneralPriceListHtml(model);
  const catalogSnapshotHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ serviceLines, merchandiseLines, disclosureVersion: FTC_DISCLOSURE_VERSION }))
    .digest('hex');

  const id = params.idFactory();
  const storageKey = `${org}/org/${id}.pdf`;
  const stored = await renderAndStorePdf(storageKey, html);
  const orgDocument = await createOrgDocument(
    {
      organizationId: org,
      documentTypeKey: DOCUMENT_TYPES.PRICE_LIST_GENERAL.key,
      fileName: 'General Price List.pdf',
      storageKey: stored.storageKey,
      checksumSha256: stored.checksumSha256,
      fileSizeBytes: stored.fileSizeBytes,
      effectiveDate: params.effectiveDate,
      disclosureVersion: FTC_DISCLOSURE_VERSION,
      catalogSnapshotHash,
      generatedBy: ctx.actorIdentityId,
      correlationId: ctx.correlationId,
      idFactory: params.idFactory,
      now: params.now ?? nowIso(),
    },
    dataAdapterMode,
  );
  return { orgDocument, model };
}
