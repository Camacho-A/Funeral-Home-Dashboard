import type { CaseSsnSummary } from '@/domain/cases/caseSsn';

/** Case SSN (2026-10): an administrator's correction. The number goes to the
    server only; the response carries the last four digits. */
export async function correctCaseSsn(params: { organizationId: string; caseId: string; ssn: string; reason: string }): Promise<CaseSsnSummary> {
  const response = await fetch(`/api/cases/${encodeURIComponent(params.caseId)}/ssn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId, ssn: params.ssn, reason: params.reason }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  return body.ssnOnFile as CaseSsnSummary;
}

export type CaseSsnBackfillReport = {
  dryRun: boolean;
  checked: number;
  counts: Record<'would_save' | 'saved' | 'already_on_file' | 'none_found', number>;
  cases: Array<{ caseNumber: string; outcome: 'would_save' | 'saved' | 'already_on_file' | 'none_found' }>;
};

/** One-time fill for existing cases (2026-10). `dryRun` changes nothing. */
export async function runCaseSsnBackfill(organizationId: string, dryRun: boolean): Promise<CaseSsnBackfillReport> {
  const response = await fetch('/api/organization/case-ssn/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, dryRun }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  return body as CaseSsnBackfillReport;
}
