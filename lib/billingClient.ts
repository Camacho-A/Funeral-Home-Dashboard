import type { BillingStatementModel } from '@/domain/billing/billingModels';
import type { CaseCashAdvanceItem } from '@/types/caseCashAdvanceItem';
import type { CaseDocument } from '@/types/caseDocument';
import type { OrgDocument } from '@/types/orgDocument';

/**
 * Phase 39 (Family Billing & FTC Compliance). Thin, typed client wrappers for
 * the billing routes. All mutating calls are same-origin (CSRF-protected
 * server-side). No client-side authority — the server recomputes everything.
 */
async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  return body;
}
const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchStatementPreview(organizationId: string, caseId: string): Promise<BillingStatementModel> {
  const body = await parseJsonOrThrow(await fetch(`/api/cases/${encodeURIComponent(caseId)}/billing/statement/preview?organizationId=${encodeURIComponent(organizationId)}`));
  return body.model as BillingStatementModel;
}

export async function generateStatement(input: { organizationId: string; caseId: string; existingDocumentId?: string; requiredPurchaseExplanations?: string | null }): Promise<CaseDocument> {
  const { caseId, ...rest } = input;
  const body = await parseJsonOrThrow(await fetch(`/api/cases/${encodeURIComponent(caseId)}/billing/statement`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(rest) }));
  return body.document as CaseDocument;
}

/** Receipt of Payment (2026-10) — separate from the Statement above; one
    never replaces the other. Returns the missing fields alongside the
    document so the caller can tell staff what the case lacked. */
export async function generateReceiptOfPayment(input: { organizationId: string; caseId: string; existingDocumentId?: string }): Promise<{ document: CaseDocument; missingFields: string[] }> {
  const { caseId, ...rest } = input;
  const body = await parseJsonOrThrow(await fetch(`/api/cases/${encodeURIComponent(caseId)}/billing/receipt`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(rest) }));
  return { document: body.document as CaseDocument, missingFields: (body.missingFields as string[]) ?? [] };
}

export async function fetchCashAdvances(organizationId: string, caseId: string): Promise<CaseCashAdvanceItem[]> {
  const body = await parseJsonOrThrow(await fetch(`/api/cases/${encodeURIComponent(caseId)}/billing/cash-advances?organizationId=${encodeURIComponent(organizationId)}`));
  return (body.items as CaseCashAdvanceItem[]) ?? [];
}

export async function createCashAdvance(input: { organizationId: string; caseId: string; description: string; amountCents: number; hasMarkup: boolean; isEstimated: boolean }): Promise<CaseCashAdvanceItem> {
  const { caseId, ...rest } = input;
  const body = await parseJsonOrThrow(await fetch(`/api/cases/${encodeURIComponent(caseId)}/billing/cash-advances`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(rest) }));
  return body.item as CaseCashAdvanceItem;
}

export async function deleteCashAdvance(organizationId: string, caseId: string, itemId: string): Promise<void> {
  await parseJsonOrThrow(await fetch(`/api/cases/${encodeURIComponent(caseId)}/billing/cash-advances/${encodeURIComponent(itemId)}?organizationId=${encodeURIComponent(organizationId)}`, { method: 'DELETE' }));
}

export async function fetchPriceLists(organizationId: string): Promise<OrgDocument[]> {
  const body = await parseJsonOrThrow(await fetch(`/api/settings/price-list?organizationId=${encodeURIComponent(organizationId)}`));
  return (body.priceLists as OrgDocument[]) ?? [];
}

export async function generatePriceList(input: { organizationId: string; effectiveDate: string }): Promise<OrgDocument> {
  const body = await parseJsonOrThrow(await fetch('/api/settings/price-list', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }));
  return body.priceList as OrgDocument;
}
