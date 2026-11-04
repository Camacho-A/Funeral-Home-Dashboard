import type { CaseFaxHistoryEntry, FaxBundleView, FaxEligibleCase, FaxSendResult } from '@/services/faxBundles/faxBundleService';

/** Manatee County DC application fax bundles (2026-11): browser calls. */

export type { CaseFaxHistoryEntry, FaxBundleView, FaxEligibleCase, FaxSendResult };
export type FaxEligibility = { cases: FaxEligibleCase[]; destinationName: string; destinationFax: string; sendingEnabled: boolean; maxApplications: number };

export class FaxRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly caseProblems: ReadonlyArray<{ caseId: string; reason: string }> = [],
  ) {
    super(message);
    this.name = 'FaxRequestError';
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new FaxRequestError(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.', response.status, Array.isArray(body.caseProblems) ? (body.caseProblems as FaxRequestError['caseProblems']) : []);
  }
  return body as T;
}

const q = (organizationId: string) => `organizationId=${encodeURIComponent(organizationId)}`;

export async function fetchFaxEligibility(organizationId: string): Promise<FaxEligibility> {
  return parse(await fetch(`/api/fax-bundles?${q(organizationId)}`, { cache: 'no-store' }));
}

export async function previewFaxBundle(organizationId: string, caseIds: string[]): Promise<FaxBundleView> {
  const response = await fetch('/api/fax-bundles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, caseIds }) });
  return (await parse<{ bundle: FaxBundleView }>(response)).bundle;
}

export const faxBundlePdfUrl = (organizationId: string, bundleId: string) => `/api/fax-bundles/${encodeURIComponent(bundleId)}/pdf?${q(organizationId)}`;

export async function sendFaxBundle(organizationId: string, bundleId: string, submissionId: string): Promise<FaxSendResult> {
  const response = await fetch(`/api/fax-bundles/${encodeURIComponent(bundleId)}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, submissionId }) });
  return parse(response);
}

export async function fetchFaxBundle(organizationId: string, bundleId: string): Promise<FaxBundleView> {
  return (await parse<{ bundle: FaxBundleView }>(await fetch(`/api/fax-bundles/${encodeURIComponent(bundleId)}?${q(organizationId)}`, { cache: 'no-store' }))).bundle;
}

export async function recordFaxOutcome(
  organizationId: string,
  bundleId: string,
  outcome: { decision: 'delivered' | 'failed'; deliveredAt?: string; nusoReference?: string; note?: string; confirmation?: File | null },
): Promise<{ bundle: FaxBundleView; checklistFailed: string[] }> {
  const form = new FormData();
  form.set('organizationId', organizationId);
  form.set('decision', outcome.decision);
  if (outcome.deliveredAt) form.set('deliveredAt', outcome.deliveredAt);
  if (outcome.nusoReference) form.set('nusoReference', outcome.nusoReference);
  if (outcome.note) form.set('note', outcome.note);
  if (outcome.confirmation) form.set('confirmation', outcome.confirmation);
  return parse(await fetch(`/api/fax-bundles/${encodeURIComponent(bundleId)}/outcome`, { method: 'POST', body: form }));
}

export async function fetchCaseFaxHistory(organizationId: string, caseId: string): Promise<CaseFaxHistoryEntry[]> {
  return (await parse<{ history: CaseFaxHistoryEntry[] }>(await fetch(`/api/cases/${encodeURIComponent(caseId)}/fax-bundles?${q(organizationId)}`, { cache: 'no-store' }))).history;
}

export function newSubmissionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
