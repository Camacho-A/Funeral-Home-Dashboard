/**
 * Manors go-live case-number cutover (2026-09). Client-side fetch
 * wrappers around `/api/organization/case-sequence/manors-go-live-cutover`
 * — mirrors every other `lib/*Client.ts` file's shape (e.g.
 * `lib/resourcesClient.ts`). `services/activityService.ts`/
 * `lib/wixCaseNumberSequence.ts` can never be called from a Client
 * Component directly.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export type ManorsCutoverEligibility = {
  organizationId: string;
  year: number;
  targetNextSequence: number;
  historicalCaseNumbers: string[];
  firstNormalCaseNumber: string;
  eligible: boolean;
  reason: string | null;
  currentNextSequence: number | null;
};

export async function fetchManorsCutoverEligibility(organizationId: string): Promise<ManorsCutoverEligibility> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/organization/case-sequence/manors-go-live-cutover?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return body as unknown as ManorsCutoverEligibility;
}

export async function executeManorsCutover(organizationId: string): Promise<{ organizationId: string; year: number; nextSequence: number }> {
  const response = await fetch('/api/organization/case-sequence/manors-go-live-cutover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body as unknown as { organizationId: string; year: number; nextSequence: number };
}
