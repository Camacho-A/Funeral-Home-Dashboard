import type { OrganizationContext } from '../types/organization';
import type { ServiceCatalogItem } from '../types/serviceCatalog';
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

/** 2026-10 (Gus Camacho Jr. service catalog). Settings › Services &
    Pricing: sets one catalog row's price (integer cents), or clears it with
    null. The route enforces `serviceCatalog.edit` and organization scope. */
export async function updateServiceCatalogPrice(
  context: OrganizationContext,
  itemId: string,
  defaultPrice: number | null,
): Promise<ServiceCatalogItem> {
  const response = await fetch(`/api/service-catalog/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: context.organizationId, defaultPrice }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to update price.');
  }
  const body = (await response.json()) as { item: ServiceCatalogItem };
  return body.item;
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

export const pricingClient = { getServiceCatalog, getCaseOrder, createCaseOrder, editCaseOrder, updateServiceCatalogPrice };
