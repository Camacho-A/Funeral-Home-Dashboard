import type { FaxTestOverview, FaxTestView } from '@/services/faxTests/faxTestService';
import type { EmailDryRunCheck, FaxTestStatus, FaxTestStep } from '@/domain/faxBundles/faxTest';

/** Fax test transmissions (2026-11): browser calls. Recipients are named by key; the server owns every address. */

export type { FaxTestOverview, FaxTestView };

const BASE = '/api/organization/fax-settings/test-transmissions';
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : fallback);
  return body as T;
}

export async function fetchFaxTests(organizationId: string): Promise<FaxTestOverview> {
  return (await parse<{ overview: FaxTestOverview }>(await fetch(`${BASE}?organizationId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' }), 'Fax tests could not be loaded.')).overview;
}

export async function sendFaxTest(
  organizationId: string,
  input: { step: FaxTestStep; recipientKey: string; submissionId: string; confirm: { acknowledged: true; recipient: string; pages: 1 | 2 } },
): Promise<{ duplicate: boolean; transmission: FaxTestView }> {
  return parse(await fetch(BASE, json({ organizationId, ...input })), 'The test could not be sent. Check the test history before trying again.');
}

export async function recordFaxTestOutcome(
  organizationId: string,
  transmissionId: string,
  input: { status: FaxTestStatus; expectedRevision: number; pagesReceived?: number; nusoReference?: string; checks?: Record<EmailDryRunCheck, boolean>; note?: string },
): Promise<FaxTestView> {
  return (await parse<{ transmission: FaxTestView }>(await fetch(`${BASE}/${encodeURIComponent(transmissionId)}/outcome`, json({ organizationId, ...input })), 'The result could not be recorded.')).transmission;
}
