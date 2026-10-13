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
import { renderReceiptOfPaymentHtml } from '../domain/billing/renderReceiptOfPaymentHtml';
import {
  formatReceiptDate,
  receiptPaymentMethodLabel,
  resolvePaidInFullDate,
  resolveReceiptPaymentStatus,
  type ReceiptLineItem,
  type ReceiptOfPaymentModel,
  type ReceiptPaymentLine,
} from '../domain/billing/receiptOfPayment';
import { composeDecedentName } from '../domain/cases/decedentName';
import { listPaymentRecordsForCase } from './paymentsService';
import { MANORS_ORGANIZATION_ID, MANORS_STATEMENT_PROVIDER_IDENTITY, shouldShowCashAdvanceSection, receiptFooterFor } from '../domain/billing/organizationStatementOverrides';
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

/** Item #2 (2026-09). Statement-only identity resolution — see
    domain/billing/organizationStatementOverrides.ts for why Manor's
    Cremation Services gets a fixed override here instead of reading its
    (currently placeholder) live Organization/Location data. The General
    Price List keeps calling providerIdentity() directly, unaffected. */
function statementProviderIdentity(organizationId: string, organization: Organization, location: OrganizationLocation | null): ProviderIdentity {
  if (organizationId === MANORS_ORGANIZATION_ID) return MANORS_STATEMENT_PROVIDER_IDENTITY;
  return providerIdentity(organization, location);
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
    provider: statementProviderIdentity(org, src.organization, src.location),
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
    showCashAdvanceSection: shouldShowCashAdvanceSection(org),
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
    provider: statementProviderIdentity(org, src.organization, src.location),
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
    showCashAdvanceSection: shouldShowCashAdvanceSection(org),
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

/**
 * Receipt of Payment (2026-10) — the family-facing acknowledgement of what
 * was charged and what has been paid, reproducing Manors' own document.
 *
 * SEPARATE FROM, NOT A REPLACEMENT FOR, the Statement of Funeral Goods and
 * Services Selected above. That statement is a legally mandated FTC
 * disclosure (16 CFR 453.2(b)(5)); this is a receipt. Both are generated,
 * each under its own document type, through the same existing document
 * pipeline.
 *
 * READ-ONLY against the books. Every figure comes from the active order
 * and the recorded payment records; nothing here posts, amends or reads
 * back a journal entry.
 */
export async function buildReceiptOfPaymentModel(
  params: { caseId: string; now?: string },
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ReceiptOfPaymentModel> {
  const src = await resolveMergeSourceData(organizationId, params.caseId, dataAdapterMode);
  if (!src.caseOrder) {
    throw new BillingDocumentServiceError(
      'This case has no active order — a receipt cannot be generated until an order exists.',
    );
  }
  const order = src.caseOrder;

  const [lineItems, catalog, payments] = await Promise.all([
    listLineItemsForOrder(organizationId, order.id, dataAdapterMode),
    getServiceCatalog(organizationId, dataAdapterMode),
    listPaymentRecordsForCase(organizationId, params.caseId, dataAdapterMode),
  ]);

  // Only money that actually cleared. A pending or failed attempt is not a
  // payment and must never appear on a receipt as one.
  const succeeded = payments.filter((p) => p.status === 'succeeded');
  const paymentLines: ReceiptPaymentLine[] = succeeded
    .slice()
    .sort((a, b) => String(a.paidAt ?? a.createdAt).localeCompare(String(b.paidAt ?? b.createdAt)))
    .map((p) => ({
      methodLabel: receiptPaymentMethodLabel({ provider: p.provider, cardBrand: p.cardBrand, cardLast4: p.cardLast4 }),
      paidAtDisplay: formatReceiptDate(p.paidAt ?? p.createdAt),
      amountCents: p.amount,
    }));

  const paidCents = paymentLines.reduce((sum, p) => sum + p.amountCents, 0);
  const codeByDisplayName = new Map(catalog.map((c) => [c.displayName, c.serviceCode]));

  const receiptLines: ReceiptLineItem[] = lineItems.map((line) => ({
    quantity: line.quantity,
    itemNumber: line.serviceCode || codeByDisplayName.get(line.description) || null,
    description: line.description,
    costCents: line.unitPrice,
    // A per-line discount is the gap between what the line would cost at
    // its unit price and what it was actually charged — derived, never a
    // second stored figure that could disagree with the order.
    discountCents: Math.max(0, line.unitPrice * line.quantity - line.lineTotal),
    totalCents: line.lineTotal,
  }));

  const grossCents = receiptLines.reduce((sum, l) => sum + l.costCents * l.quantity, 0);
  const discountCents = Math.max(0, grossCents - order.total);
  const status = resolveReceiptPaymentStatus({ balanceDueCents: order.balanceDue, paidCents });

  /** Named, not silently blank — staff see what the case is missing
      before the document goes to a family. */
  const missingFields: string[] = [];
  if (!src.case.caseNumber) missingFields.push('Case number');
  if (!src.case.decedentName) missingFields.push("Deceased's name");
  if (!formatReceiptDate(src.case.dateOfDeath)) missingFields.push('Date of death');
  if (!src.case.nextOfKinName) missingFields.push('Responsible family member');
  if (receiptLines.length === 0) missingFields.push('Itemised charges');

  return {
    provider: statementProviderIdentity(organizationId, src.organization, src.location),
    footer: receiptFooterFor(organizationId, statementProviderIdentity(organizationId, src.organization, src.location).name),
    statementDateDisplay: formatReceiptDate(params.now ?? nowIso()) ?? '',
    caseNumber: src.case.caseNumber,
    soldToName: src.case.nextOfKinName || null,
    // The canonical composition, so the middle name reads here exactly as
    // it does on every other surface.
    deceasedName: composeDecedentName(src.case.decedentName, src.case.decedentMiddleName),
    dateOfDeathDisplay: formatReceiptDate(src.case.dateOfDeath),
    status,
    paidInFullDateDisplay: resolvePaidInFullDate(status, paymentLines),
    payments: paymentLines,
    lineItems: receiptLines,
    totalChargeCents: order.total,
    discountCents,
    paymentCents: paidCents,
    balanceDueCents: order.balanceDue,
    missingFields,
  };
}

export async function generateReceiptOfPayment(
  params: { caseId: string; existingDocumentId?: string; idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ document: CaseDocument; model: ReceiptOfPaymentModel }> {
  const model = await buildReceiptOfPaymentModel(params, ctx.organizationId, dataAdapterMode);
  const document = await generateBillingDocument(
    {
      caseId: params.caseId,
      documentTypeKey: DOCUMENT_TYPES.STATEMENT_ACCOUNT.key,
      category: 'statement',
      fileName: `Receipt of Payment - ${model.caseNumber}.pdf`,
      bodyHtml: renderReceiptOfPaymentHtml(model),
      existingDocumentId: params.existingDocumentId,
      idFactory: params.idFactory,
      now: params.now,
    },
    ctx,
    dataAdapterMode,
  );
  return { document, model };
}

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
