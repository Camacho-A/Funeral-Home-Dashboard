/**
 * Case repair UI (2026-09). Client-side fetch wrapper around the
 * already-deployed `POST /api/cases/[caseId]/recalculate-workflow` —
 * mirrors `lib/externalFormsClient.ts`'s exact shape. No new server-side
 * logic — this file only ever calls the existing endpoint.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export type RecalculateWorkflowResult = { rawStage: number; changed: boolean };

export async function recalculateCaseWorkflow(organizationId: string, caseId: string): Promise<RecalculateWorkflowResult> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/recalculate-workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body as unknown as RecalculateWorkflowResult;
}
