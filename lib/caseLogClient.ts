import type { CaseLogEntry, NewCaseLogEntryInput } from '@/types/caseLogEntry';

/**
 * Raw-field-name leak fix follow-up (2026-10). Client-side fetch wrappers
 * around `/api/cases/[caseId]/log` — Case Log's only path to the server,
 * matching every other `lib/*Client.ts` module's reasoning (see
 * `lib/activityClient.ts`'s own header comment): `services/caseLogService.ts`
 * now imports `lib/wixDataApi.ts` (server-only, holds WIX_API_KEY) and can
 * never be imported into a Client Component.
 */
async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchCaseLog(caseId: string, organizationId: string): Promise<CaseLogEntry[]> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/log?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.entries as CaseLogEntry[]) ?? [];
}

export async function createCaseLogEntry(caseId: string, organizationId: string, input: NewCaseLogEntryInput): Promise<CaseLogEntry> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, ...input }),
  });
  const body = await parseJsonOrThrow(response);
  return body.entry as CaseLogEntry;
}
