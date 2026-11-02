import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case } from '@/types/case';
import {
  CASE_REVISION_CONFLICT_REASON,
  CaseRevisionConflictError,
  isCaseRevisionConflictError,
} from '@/domain/cases/caseRevisionConflict';
import { caseRevision } from '@/lib/wixCaseMapper';
import type { CaseEditConflict } from './useCaseMutations';
import { useOrganization } from './useOrganization';

/**
 * Service-specific completion (2026-10). The Case Detail "Mark completed"
 * action — POST /api/cases/[caseId]/complete, which re-makes every
 * decision server-side (policy, permission, stage, remains return, reason).
 *
 * Joins the SAME per-case edit queue as hooks/useCaseMutations.ts (the
 * mutation `scope`), so a completion never overtakes an edit staff made a
 * moment earlier, and it is pinned to the revision the page holds once
 * those edits have landed (`expectedRevision`). A 409 revision conflict
 * surfaces as `conflict` for the page's existing CaseEditConflictBanner
 * (Refresh / Retry), exactly like a refused Case Information edit.
 *
 * On success the returned case goes straight into the case query and the
 * case + list queries are refetched (completion may also archive it).
 *
 * The request always carries `expectedRevision` (the server refuses one
 * without it). Local mock data (Phase 5A.1): the dev server decides and
 * records the completion, so the browser's copy of the case is sent to it
 * first and the server's answer is adopted back into the browser copy —
 * see services/mockCaseStoreClient.ts. That is what keeps a completed case
 * completed in Case Detail, the dashboard and reports, across reloads.
 */

export class CaseCompletionError extends Error {
  readonly status: number;
  readonly details: string[];
  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.name = 'CaseCompletionError';
    this.status = status;
    this.details = details;
  }
}

export type CompleteCaseResult = { case: Case; completion: { mode: 'automatic' | 'manual' | null; archived: boolean } };

export async function requestCaseCompletion(
  organizationId: string,
  caseId: string,
  reason: string,
  expectedRevision?: number,
): Promise<CompleteCaseResult> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, reason, ...(expectedRevision !== undefined ? { expectedRevision } : {}) }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.error === 'string' && body.error.trim() !== '' ? body.error : 'The case could not be completed. Please try again.';
    if (response.status === 409 && body.reason === CASE_REVISION_CONFLICT_REASON) {
      throw new CaseRevisionConflictError((body.case as Case | undefined) ?? null, message);
    }
    const details = Array.isArray(body.details) ? body.details.filter((d): d is string => typeof d === 'string') : [];
    throw new CaseCompletionError(message, response.status, details);
  }
  return body as unknown as CompleteCaseResult;
}

export function useCompleteCase(caseId: string) {
  const organization = useOrganization();
  const { organizationId } = organization;
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<(CaseEditConflict & { reason: string }) | null>(null);

  const completion = useMutation({
    // Same scope id as useCaseMutations — one ordered queue per case per tab.
    scope: { id: `case-edit:${organizationId}:${caseId}` },
    mutationFn: async ({ reason }: { reason: string }) => {
      const cached = queryClient.getQueryData<Case>(['case', organizationId, caseId]);
      return requestCaseCompletion(organizationId, caseId, reason, cached ? caseRevision(cached) : 0);
    },
    onError: (error, { reason }) => {
      if (isCaseRevisionConflictError(error)) {
        setConflict({ patch: {}, message: error.message, current: error.current, reason });
      }
    },
    onSuccess: async (result) => {
      if (result?.case) queryClient.setQueryData(['case', organizationId, caseId], result.case);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] }),
        queryClient.invalidateQueries({ queryKey: ['cases', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['caseActivity', organizationId, caseId] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
      ]);
    },
  });

  const { mutate, reset } = completion;

  /** Refresh = show the latest case and drop the refused completion. */
  const refreshAfterConflict = useCallback(async () => {
    const current = conflict?.current ?? null;
    setConflict(null);
    reset();
    if (current) queryClient.setQueryData(['case', organizationId, caseId], current);
    await queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] });
  }, [conflict, queryClient, organizationId, caseId, reset]);

  /** Retry = load the latest case, then ask again with the same reason —
      re-decided by the server against that version. */
  const retryAfterConflict = useCallback(async () => {
    if (!conflict) return;
    const { current, reason } = conflict;
    setConflict(null);
    reset();
    if (current) queryClient.setQueryData(['case', organizationId, caseId], current);
    else await queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] });
    mutate({ reason });
  }, [conflict, queryClient, organizationId, caseId, mutate, reset]);

  return {
    complete: (reason: string, options?: { onSuccess?: () => void }) => mutate({ reason }, options),
    isPending: completion.isPending,
    isSuccess: completion.isSuccess,
    /** A refusal other than a revision conflict (403/409/422/503) — shown in
        the confirmation panel. */
    error: completion.error && !isCaseRevisionConflictError(completion.error) ? (completion.error as Error) : null,
    conflict,
    refreshAfterConflict,
    retryAfterConflict,
    reset,
  };
}
