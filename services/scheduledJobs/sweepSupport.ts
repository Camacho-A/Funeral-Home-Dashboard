import { getDeploymentOrganizationIds } from '../../lib/env';
import { isOrganizationAllowedInDeployment } from '../../lib/auth/deploymentOrganizations';
import { conditionalPatchWixDataItem, queryWixDataItems } from '../../lib/wixDataApi';

/**
 * Scheduled-job isolation (2026-10) — shared support for every
 * cron-triggered sweep (bill reminders, notification digest, appointment
 * reminders, calendar sync). See docs/SCHEDULED_JOBS.md.
 *
 * Two layers, both always applied:
 *  1. `deploymentOrganizationWixFilter()` pushes the deployment allowlist
 *     (`DEPLOYMENT_ORGANIZATION_IDS`) into the Wix query itself, so another
 *     deployment's rows are never even read.
 *  2. `retainDeploymentRecords()` re-checks every returned record with
 *     `isOrganizationAllowedInDeployment` before the sweep acts on it
 *     (defense in depth against a filter that was dropped, mis-typed, or not
 *     honoured by the backend).
 * Unrestricted (allowlist null — local/mock only; production on Wix throws
 * in lib/env.ts) keeps the historical every-organization behaviour.
 */

/** Wix filter fragment restricting a sweep query to this deployment's organizations ({} when unrestricted). */
export function deploymentOrganizationWixFilter(): { organizationId?: string | { $in: string[] } } {
  const allowed = getDeploymentOrganizationIds();
  if (allowed === null) return {};
  // Exact equality for the common single-tenant case (index-friendly);
  // `$in` (used live by lib/casePagination.ts's currentStage filter) for a
  // multi-organization deployment.
  return { organizationId: allowed.length === 1 ? allowed[0] : { $in: [...allowed] } };
}

/** Per-record re-check — drops (and logs a count for) anything outside this deployment. */
export function retainDeploymentRecords<T>(jobName: string, records: readonly T[], organizationIdOf: (record: T) => string | null | undefined): T[] {
  const kept = records.filter((record) => isOrganizationAllowedInDeployment(organizationIdOf(record)));
  const dropped = records.length - kept.length;
  if (dropped > 0) {
    console.warn(`[${jobName}] skipped ${dropped} record(s) belonging to organizations outside this deployment.`);
  }
  return kept;
}

/**
 * How long a sweep's claim on a row is honoured before another sweep may
 * treat it as abandoned (a crashed/timed-out invocation). Comfortably above
 * any Vercel function max duration, so a live sweep's claim never expires
 * under it.
 */
export const SWEEP_CLAIM_TTL_MS = 15 * 60_000;

export function isClaimFresh(claimedAt: string | null | undefined, nowMs: number): boolean {
  if (!claimedAt) return false;
  const claimedMs = new Date(claimedAt).getTime();
  return Number.isFinite(claimedMs) && nowMs - claimedMs < SWEEP_CLAIM_TTL_MS;
}

export type SweepClaimOutcome =
  /** This sweep now owns the row. */
  | 'claimed'
  /** Another sweep claimed/changed/removed it first — skip. */
  | 'contended'
  /** The conditional write was rejected but the row is unchanged — the backend did not apply
      the condition at all (e.g. an optional claim field not yet accepted). Caller falls back to
      the pre-claim behaviour and logs it; see docs/SCHEDULED_JOBS.md "production dependencies". */
  | 'unverifiable';

/**
 * Claim-before-send on Wix: a compare-and-swap `SET_FIELD` via Wix's
 * documented PatchDataItem `condition` (lib/wixDataApi.ts
 * `conditionalPatchWixDataItem`, live-verified 2026-09 for single-winner
 * races). Only one of N concurrent sweeps can observe its own conditional
 * write take effect.
 *
 * `conditionalPatchWixDataItem` reports "condition not met" and "request
 * failed" identically, so a rejected claim is followed by one re-read: if
 * the row changed (or is gone) another sweep won → 'contended'; if it is
 * still exactly as observed → 'unverifiable'. A failed re-read is treated
 * as 'contended' (skip now, retry next sweep — never risk a double send).
 */
export async function claimWixSweepRow(params: {
  collection: string;
  wixItemId: string;
  fieldPath: string;
  claimValue: string;
  condition: Record<string, unknown>;
  isUnchanged: (data: Record<string, unknown>) => boolean;
}): Promise<SweepClaimOutcome> {
  const patched = await conditionalPatchWixDataItem(params.collection, params.wixItemId, params.fieldPath, params.claimValue, { filter: params.condition });
  if (patched.applied) return 'claimed';
  try {
    const reread = await queryWixDataItems<Record<string, unknown>>(params.collection, { filter: { _id: params.wixItemId }, paging: { limit: 1 } });
    const current = reread.dataItems[0];
    if (!current) return 'contended';
    return params.isUnchanged(current.data) ? 'unverifiable' : 'contended';
  } catch {
    return 'contended';
  }
}

/** Normalizes an absent Wix field to null for `$eq` comparisons. */
export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
