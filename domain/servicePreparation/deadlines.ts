import type { PreparationTargetKey } from './types';

/**
 * Preparation deadlines (Gus Phase 5B, 2026-11). Operational targets
 * relative to the service's start — NOT legal deadlines. They are always
 * worked out from the service's current start, never stored, so a
 * reschedule moves every deadline with nothing to rewrite or duplicate.
 *
 * A target is a window: from `earliestHoursBefore` the item is due; after
 * `latestHoursBefore` it is overdue. When the service was booked after the
 * latest point (a short-notice arrangement), the item is "Due now — short
 * notice" instead of overdue, and flagged for staff review.
 */
export type PreparationTarget = { earliestHoursBefore: number; latestHoursBefore: number; label: string };

export const DEFAULT_PREPARATION_TARGETS: Readonly<Record<PreparationTargetKey, PreparationTarget>> = {
  crematory_notification: { earliestHoursBefore: 72, latestHoursBefore: 48, label: 'Crematory notification' },
  casket_order: { earliestHoursBefore: 72, latestHoursBefore: 48, label: 'Casket order' },
  church_coordination: { earliestHoursBefore: 72, latestHoursBefore: 48, label: 'Church coordination' },
  clergy_confirmation: { earliestHoursBefore: 48, latestHoursBefore: 24, label: 'Clergy confirmation' },
  casket_spray: { earliestHoursBefore: 48, latestHoursBefore: 24, label: 'Casket spray' },
  prayer_card_printing: { earliestHoursBefore: 48, latestHoursBefore: 48, label: 'Prayer card printing' },
};

/** Less than this before the service, anything still open is urgent. */
export const URGENT_HOURS_BEFORE_SERVICE = 24;

const HOUR = 60 * 60 * 1000;

export type DeadlineState =
  /** Not due yet. */
  | 'upcoming'
  /** Inside its window. */
  | 'due'
  /** Booked too late for the target: due now, flagged for review. */
  | 'short_notice'
  | 'overdue';

export const DEADLINE_STATE_LABEL: Record<DeadlineState, string> = {
  upcoming: 'Upcoming',
  due: 'Due',
  short_notice: 'Due now — short notice',
  overdue: 'Overdue',
};

export type EvaluatedDeadline = {
  target: PreparationTargetKey;
  opensAt: string;
  dueAt: string;
  state: DeadlineState;
  /** Open and the service is less than a day away (or has started). */
  urgent: boolean;
  /** Staff should look at it: short notice, overdue or urgent. */
  needsReview: boolean;
};

export function resolvePreparationTargets(overrides?: Partial<Record<PreparationTargetKey, Partial<PreparationTarget>>>): Record<PreparationTargetKey, PreparationTarget> {
  const targets = { ...DEFAULT_PREPARATION_TARGETS } as Record<PreparationTargetKey, PreparationTarget>;
  for (const [key, override] of Object.entries(overrides ?? {}) as [PreparationTargetKey, Partial<PreparationTarget>][]) {
    const merged = { ...targets[key], ...override };
    if (!(merged.earliestHoursBefore >= merged.latestHoursBefore && merged.latestHoursBefore >= 0)) {
      throw new Error(`${merged.label}: the window must open before it closes.`);
    }
    targets[key] = merged;
  }
  return targets;
}

/** The deadline of one open (not yet done) item. */
export function evaluateDeadline(params: {
  target: PreparationTargetKey;
  serviceStartAt: string;
  bookedAt: string;
  now: string;
  targets?: Readonly<Record<PreparationTargetKey, PreparationTarget>>;
}): EvaluatedDeadline {
  const t = (params.targets ?? DEFAULT_PREPARATION_TARGETS)[params.target];
  const start = Date.parse(params.serviceStartAt);
  const now = Date.parse(params.now);
  const opens = start - t.earliestHoursBefore * HOUR;
  const due = start - t.latestHoursBefore * HOUR;
  const bookedLate = Date.parse(params.bookedAt) > due;
  const state: DeadlineState = bookedLate && now < start ? 'short_notice' : now >= due ? 'overdue' : now >= opens ? 'due' : 'upcoming';
  const urgent = now >= start - URGENT_HOURS_BEFORE_SERVICE * HOUR;
  return {
    target: params.target,
    opensAt: new Date(opens).toISOString(),
    dueAt: new Date(due).toISOString(),
    state,
    urgent,
    needsReview: state === 'short_notice' || state === 'overdue' || urgent,
  };
}
