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
  return body.catalog;
}

export type CaseOrderResult = { order: CaseOrder | null; lineItems: CaseOrderLineItem[]; auditEntries: CaseOrderAuditEntry[] };

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
function buildSelectionsBody(input: { selections: ServiceSelections; customItems?: CustomLineItemSelection[] }) {
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

export async function editCaseOrder(
  context: OrganizationContext,
  caseId: string,
  input: { selections: ServiceSelections; customItems?: CustomLineItemSelection[] },
): Promise<CaseOrderResult> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: context.organizationId, selections: buildSelectionsBody(input) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to update case order.');
  }
  return response.json();
}

export const pricingClient = { getServiceCatalog, getCaseOrder, createCaseOrder, editCaseOrder };
