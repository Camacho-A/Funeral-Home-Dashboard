import type { DigestFrequency } from '../../types/notificationPreference';

/**
 * Phase 33 (Real Notification Delivery). Pure timing logic behind the
 * digest/quiet-hours deferral mechanism — no I/O, no `Date.now()`
 * (every function takes `nowIso` explicitly, so this is fully
 * deterministic and testable without a real clock). Used by both
 * `services/notificationService.ts#dispatchChannel` (deciding whether to
 * defer a send) and `services/notificationDigestService.ts` (deciding
 * whether a queued group is now eligible to flush). See
 * docs/adr/ADR-037-real-notification-delivery.md.
 *
 * Org-local time is resolved via `Intl.DateTimeFormat` with the org's
 * own `timezone`, the same hand-rolled, no-new-dependency technique
 * `utils/scheduling.ts` already established for appointment times in
 * Phase 27 — `hourCycle: 'h23'` (not `hour12: false`) avoids that API's
 * known "24:00 instead of 00:00 at midnight" quirk.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_INTERVAL_MS: Record<'daily' | 'weekly', number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
};

/** "HH:mm" in the given timezone (UTC if unset — every `Organization`
    predating Phase 20's optional `timezone` field falls back here). */
export function orgLocalTime(nowIso: string, timezone: string | undefined): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone || 'UTC',
  }).format(new Date(nowIso));
}

/** Handles the overnight-wrap case (e.g. "22:00"-"07:00") as well as a
    same-day window (e.g. "13:00"-"15:00") via a single comparison rule:
    if start <= end it's a same-day window; otherwise it wraps past
    midnight. A caller with only one of the two bounds set is never
    "in quiet hours" — both must be configured. */
export function isWithinQuietHours(nowIso: string, timezone: string | undefined, quietHoursStart: string | null, quietHoursEnd: string | null): boolean {
  if (!quietHoursStart || !quietHoursEnd) return false;
  const current = orgLocalTime(nowIso, timezone);
  if (quietHoursStart <= quietHoursEnd) {
    return current >= quietHoursStart && current < quietHoursEnd;
  }
  return current >= quietHoursStart || current < quietHoursEnd;
}

/** Whether enough time has passed since `lastDigestSentAt` for a
    `'daily'`/`'weekly'` digest to send again. A never-sent identity
    (`lastDigestSentAt === null`) is always eligible immediately — no
    reason to wait out a full interval before someone's very first
    digest. Never called for `digestFrequency === 'instant'` — that case
    is decided by quiet hours alone, not this function (see
    `services/notificationDigestService.ts`). */
export function hasDigestIntervalElapsed(lastDigestSentAt: string | null, digestFrequency: 'daily' | 'weekly', nowIso: string): boolean {
  if (!lastDigestSentAt) return true;
  const elapsedMs = new Date(nowIso).getTime() - new Date(lastDigestSentAt).getTime();
  return elapsedMs >= DIGEST_INTERVAL_MS[digestFrequency];
}

/** The one combined eligibility check `notificationDigestService.ts`'s
    sweep calls per queued group, re-evaluated against the identity's
    *current* preference (never a snapshot taken at queue time — a
    preference change between queueing and the sweep takes effect
    immediately, exactly like every other preference read in this
    codebase). If `digestFrequency !== 'instant'`, only the interval
    matters (a batched-by-preference identity's rows were never queued
    *because of* quiet hours specifically, even if quiet hours also
    happen to be active right now — see this file's own header comment
    for why these two reasons aren't compounded). If it's `'instant'`,
    the only possible reason a row is queued at all is quiet hours, so
    eligibility is exactly "no longer within them." */
export function isDigestGroupEligible(params: {
  digestFrequency: DigestFrequency;
  lastDigestSentAt: string | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | undefined;
  nowIso: string;
}): boolean {
  if (params.digestFrequency === 'instant') {
    return !isWithinQuietHours(params.nowIso, params.timezone, params.quietHoursStart, params.quietHoursEnd);
  }
  return hasDigestIntervalElapsed(params.lastDigestSentAt, params.digestFrequency, params.nowIso);
}

/** Whether an `'email'` send should be deferred to the digest queue
    instead of attempted immediately — the one check
    `services/notificationService.ts#dispatchChannel` makes before every
    email send. True whenever the preference asks for batching
    (`digestFrequency !== 'instant'`) or the org-local time is currently
    inside quiet hours. */
export function shouldDeferEmailForDigest(params: {
  digestFrequency: DigestFrequency;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | undefined;
  nowIso: string;
}): boolean {
  if (params.digestFrequency !== 'instant') return true;
  return isWithinQuietHours(params.nowIso, params.timezone, params.quietHoursStart, params.quietHoursEnd);
}
