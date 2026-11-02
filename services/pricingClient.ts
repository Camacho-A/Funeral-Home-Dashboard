import type { OrganizationContext } from '../types/organization';
import type { ServiceCatalogCategory, ServiceCatalogItem } from '../types/serviceCatalog';
import type { CaseOrder, CaseOrderLineItem, ServiceSelections, CustomLineItemSelection } from '../types/caseOrder';
import type { CaseOrderAuditEntry } from '../types/caseOrderAudit';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Client-side
 * calls to /api/service-catalog and /api/cases/[caseId]/order — same shape
 * as services/paymentsClient.ts: never branches on DATA_ADAPTER itself,
 * always calls the Route Handler, which alone decides mock vs. wix.
 */

export async function getServiceCatalog(context: OrganizationContext): Promise<ServiceCatalogItem[]> {
  const response = await fetch(`/api/service-catalog?organizationId=${encodeURIComponent(context.organizationId)}`);
  if (!response.ok) {
    throw new Error('Failed to load service catalog.');
  }
  const body = (await response.json()) as { catalog: ServiceCatalogItem[] };
  // 2026-10: defense in depth — the route is already org-scoped; a row of
  // any other organization is never rendered or priced in this one's UI.
  return body.catalog.filter((item) => item.organizationId === context.organizationId);
}

/** Gus Phase 5C-3. A refusal from a Settings › Price Catalog write — the
    server's own message, plus its status (409 = changed by someone else or a
    duplicate code/name) so the screen can say what happened. */
export class PriceCatalogRequestError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string | null) {
    super(message);
    this.name = 'PriceCatalogRequestError';
  }
}

async function priceCatalogWrite<T>(url: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, fallback: string): Promise<T> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; reason?: string }) | null;
  if (!response.ok) throw new PriceCatalogRequestError(payload?.error ?? fallback, response.status, payload?.reason ?? null);
  return payload as T;
}

/** Gus Phase 5C-3. Settings › Price Catalog: every item (inactive too) and
    every display category. Takes `serviceCatalog.read`. */
export async function getPriceCatalog(context: OrganizationContext): Promise<{ catalog: ServiceCatalogItem[]; categories: ServiceCatalogCategory[] }> {
  const response = await fetch(`/api/service-catalog?organizationId=${encodeURIComponent(context.organizationId)}&includeInactive=1`);
  if (!response.ok) throw new Error('Failed to load the price catalog.');
  const body = (await response.json()) as { catalog: ServiceCatalogItem[]; categories?: ServiceCatalogCategory[] };
  return {
    catalog: body.catalog.filter((item) => item.organizationId === context.organizationId),
    categories: (body.categories ?? []).filter((category) => category.organizationId === context.organizationId),
  };
}

/** Gus Phase 5C-3. The active display categories, for grouping catalog items
    on a case order. */
export async function getCatalogCategories(context: OrganizationContext): Promise<ServiceCatalogCategory[]> {
  const response = await fetch(`/api/service-catalog?organizationId=${encodeURIComponent(context.organizationId)}`);
  if (!response.ok) throw new Error('Failed to load catalog categories.');
  const body = (await response.json()) as { categories?: ServiceCatalogCategory[] };
  return (body.categories ?? []).filter((category) => category.organizationId === context.organizationId);
}

export type NewCatalogItemInput = {
  itemCode: string;
  displayName: string;
  description: string | null;
  categoryId: string | null;
  pricingType: 'flat' | 'per_unit';
  defaultPrice: number | null;
  ftcClass: string | null;
};

export async function createCatalogItem(context: OrganizationContext, input: NewCatalogItemInput): Promise<ServiceCatalogItem> {
  const body = await priceCatalogWrite<{ item: ServiceCatalogItem }>(
    '/api/service-catalog',
    'POST',
    { organizationId: context.organizationId, ...input },
    'Failed to add the catalog item.',
  );
  return body.item;
}

export type CatalogItemChanges = Partial<{
  displayName: string;
  description: string | null;
  categoryId: string | null;
  defaultPrice: number | null;
  isActive: boolean;
  ftcClass: string | null;
  merchandiseProductId: string | null;
}>;

export async function updateCatalogItem(
  context: OrganizationContext,
  itemId: string,
  changes: CatalogItemChanges,
  expectedRevision: number,
  options: { confirmPrimaryServiceDeactivation?: boolean } = {},
): Promise<ServiceCatalogItem> {
  const body = await priceCatalogWrite<{ item: ServiceCatalogItem }>(
    `/api/service-catalog/${encodeURIComponent(itemId)}`,
    'PATCH',
    {
      organizationId: context.organizationId,
      expectedRevision,
      ...changes,
      ...(options.confirmPrimaryServiceDeactivation ? { confirmPrimaryServiceDeactivation: true } : {}),
    },
    'Failed to save the catalog item.',
  );
  return body.item;
}

export async function createCatalogCategory(context: OrganizationContext, name: string): Promise<ServiceCatalogCategory> {
  const body = await priceCatalogWrite<{ category: ServiceCatalogCategory }>(
    '/api/service-catalog/categories',
    'POST',
    { organizationId: context.organizationId, name },
    'Failed to add the category.',
  );
  return body.category;
}

export async function updateCatalogCategory(
  context: OrganizationContext,
  categoryId: string,
  changes: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
  expectedRevision: number,
): Promise<ServiceCatalogCategory> {
  const body = await priceCatalogWrite<{ category: ServiceCatalogCategory }>(
    `/api/service-catalog/categories/${encodeURIComponent(categoryId)}`,
    'PATCH',
    { organizationId: context.organizationId, expectedRevision, ...changes },
    'Failed to save the category.',
  );
  return body.category;
}

/** Phase 5A.2: `interruption` — an unfinished change holds the case's
    order (GET only). `order` is then the version the case is still billed
    for; editing and payments are refused until it finishes or an
    administrator repairs it. */
export type CaseOrderInterruptionInfo = { pendingOrderId: string; previousOrderId: string | null; since: string; stale: boolean };
export type CaseOrderResult = { order: CaseOrder | null; lineItems: CaseOrderLineItem[]; auditEntries: CaseOrderAuditEntry[]; interruption?: CaseOrderInterruptionInfo | null };

export async function getCaseOrder(context: OrganizationContext, caseId: string): Promise<CaseOrderResult> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}/order?organizationId=${encodeURIComponent(context.organizationId)}`,
  );
  if (!response.ok) {
    throw new Error('Failed to load case order.');
  }
  return response.json();
}

/** SOLIS cleanup item #11 (2026-09): `customItems`, when provided, nests
    inside `selections` on the wire — the server's own extraction reads it
    from that same object (see services/pricingService.ts's
    extractCustomItemSelections), exactly like `merchandise` already does. */
export function buildSelectionsBody(input: { selections: ServiceSelections; customItems?: CustomLineItemSelection[] }) {
  return input.customItems !== undefined
    ? { ...input.selections, customItems: input.customItems }
    : input.selections;
}

export async function createCaseOrder(
  context: OrganizationContext,
  caseId: string,
  input: { selections: ServiceSelections; customItems?: CustomLineItemSelection[] },
): Promise<CaseOrderResult> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: context.organizationId, selections: buildSelectionsBody(input) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to create case order.');
  }
  return response.json();
}

/**
 * Non-destructive order versioning (2026-10). The edited order version is
 * no longer the active one: someone else changed this case's services
 * first (HTTP 409 `order_conflict`). Nothing was saved. `current` is the
 * active order as the server sees it now (null if unknown).
 */
export class CaseOrderChangedError extends Error {
  readonly current: CaseOrder | null;
  constructor(message: string, current: CaseOrder | null) {
    super(message);
    this.name = 'CaseOrderChangedError';
    this.current = current;
  }
}

export function isCaseOrderChangedError(error: unknown): error is CaseOrderChangedError {
  return error instanceof CaseOrderChangedError;
}

/** `expectedOrderId` is the id of the order version being edited — the
    server refuses an edit without it (428) and refuses a stale one (409,
    CaseOrderChangedError), so an edit never silently replaces a newer one. */
export async function editCaseOrder(
  context: OrganizationContext,
  caseId: string,
  input: { selections: ServiceSelections; customItems?: CustomLineItemSelection[]; expectedOrderId: string },
): Promise<CaseOrderResult> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: context.organizationId, selections: buildSelectionsBody(input), expectedOrderId: input.expectedOrderId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 409 && body?.reason === 'order_conflict') {
      throw new CaseOrderChangedError(body?.error ?? "This case's services were changed by someone else.", (body?.order as CaseOrder | null | undefined) ?? null);
    }
    throw new Error(body?.error ?? 'Failed to update case order.');
  }
  return response.json();
}

export const pricingClient = {
  getServiceCatalog,
  getCaseOrder,
  createCaseOrder,
  editCaseOrder,
  getPriceCatalog,
  getCatalogCategories,
  createCatalogItem,
  updateCatalogItem,
  createCatalogCategory,
  updateCatalogCategory,
};
