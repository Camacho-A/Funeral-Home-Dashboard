import type { ReleaseEvent, ServicePreparationRecord } from './types';

/**
 * The release status worked out from the append-only release events (Gus,
 * 2026-11). Pure, with no other imports, so both the preparation rules
 * (preparationUpdates.ts) and the release workflow (releaseHolds.ts) can
 * use it.
 */
export type ReleaseStatus = 'not_released' | 'awaiting_signoff' | 'released' | 'on_hold' | 'awaiting_reauthorization' | 'reauthorized';

export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  not_released: 'Not released',
  awaiting_signoff: 'Release requested — awaiting licensed sign-off',
  released: 'Released',
  on_hold: 'On hold',
  awaiting_reauthorization: 'Reauthorization requested — awaiting licensed sign-off',
  reauthorized: 'Reauthorized',
};

/** The events, oldest first. A record released before the workflow
    existed (only `release`) reads as one `released` event. */
export function releaseEventsOf(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseEvent[] {
  if (!record) return [];
  if (record.releaseEvents && record.releaseEvents.length > 0) return record.releaseEvents;
  if (!record.release) return [];
  return [
    {
      eventId: record.release.eventId ?? 'release-legacy',
      type: 'released',
      at: record.release.releasedAt,
      actorId: record.release.releasedBy,
      actorName: record.release.releasedByName,
      roleKey: record.release.roleKey,
      approval: record.release.approval ?? null,
    },
  ];
}

type ReleaseState = {
  status: ReleaseStatus;
  /** The event that put the release on hold (a hold or a correction), while it is. */
  hold: ReleaseEvent | null;
  /** The request awaiting sign-off, while one is. */
  pendingRequest: ReleaseEvent | null;
  /** The latest sign-off (released / reauthorized) not corrected. */
  signOffInForce: ReleaseEvent | null;
  correctedIds: ReadonlySet<string>;
};

const INITIAL: ReleaseState = { status: 'not_released', hold: null, pendingRequest: null, signOffInForce: null, correctedIds: new Set() };

/** One event applied to the state — the single place the status rules live. */
function step(state: ReleaseState, event: ReleaseEvent): ReleaseState {
  switch (event.type) {
    case 'release_requested':
      return { ...state, status: 'awaiting_signoff', pendingRequest: event };
    case 'reauthorization_requested':
      return { ...state, status: 'awaiting_reauthorization', pendingRequest: event };
    case 'released':
    case 'reauthorized':
      return { ...state, status: event.type, hold: null, pendingRequest: null, signOffInForce: event };
    case 'hold_placed':
      return { ...state, status: 'on_hold', hold: event, pendingRequest: null };
    case 'request_withdrawn':
      return { ...state, status: state.status === 'awaiting_reauthorization' ? 'on_hold' : 'not_released', pendingRequest: null };
    case 'release_corrected': {
      const correctedIds = new Set(state.correctedIds).add(event.correctsEventId ?? '');
      const inForce = state.signOffInForce?.eventId === event.correctsEventId;
      if (inForce && isReleasedStatus(state.status)) return { ...state, status: 'on_hold', hold: event, signOffInForce: null, correctedIds };
      return { ...state, correctedIds, signOffInForce: inForce ? null : state.signOffInForce };
    }
  }
}

function releaseStateOf(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseState {
  return releaseEventsOf(record).reduce(step, INITIAL);
}

export function releaseStatusOf(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseStatus {
  return releaseStateOf(record).status;
}

/** Released and not on hold — the only state in which paperwork may go to the crematory. */
export const isReleasedStatus = (status: ReleaseStatus) => status === 'released' || status === 'reauthorized';

/** The hold now in force (a hold, or a correction that put the release on hold), if any. */
export function currentHold(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseEvent | null {
  const state = releaseStateOf(record);
  return state.status === 'on_hold' || state.status === 'awaiting_reauthorization' ? state.hold : null;
}

/** The request awaiting a licensed sign-off, if any. */
export function pendingReleaseRequest(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseEvent | null {
  return releaseStateOf(record).pendingRequest;
}

/** The sign-off events a correction may still reference (oldest first). */
export function correctableSignOffs(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseEvent[] {
  const { correctedIds } = releaseStateOf(record);
  return releaseEventsOf(record).filter((e) => (e.type === 'released' || e.type === 'reauthorized') && !correctedIds.has(e.eventId));
}
