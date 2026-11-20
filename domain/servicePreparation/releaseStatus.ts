import type { ReleaseEvent, ServicePreparationRecord } from './types';

/**
 * The release status worked out from the append-only release events (Gus,
 * 2026-11). Pure, with no other imports, so both the preparation rules
 * (preparationUpdates.ts) and the release workflow (releaseHolds.ts) can
 * use it.
 */
export type ReleaseStatus = 'not_released' | 'awaiting_signoff' | 'released' | 'on_hold' | 'awaiting_reauthorization' | 'reauthorized' | 'correction_pending';

export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  not_released: 'Not released',
  awaiting_signoff: 'Release requested — awaiting licensed sign-off',
  released: 'Released',
  on_hold: 'On hold',
  awaiting_reauthorization: 'Reauthorization requested — awaiting licensed sign-off',
  reauthorized: 'Reauthorized',
  correction_pending: 'Correction awaiting independent confirmation — sending blocked',
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
  /** A correction of the sign-off in force awaiting independent confirmation, and the status it would return to if withdrawn. */
  pendingCorrection: ReleaseEvent | null;
  statusBeforeCorrection: ReleaseStatus | null;
};

const INITIAL: ReleaseState = { status: 'not_released', hold: null, pendingRequest: null, signOffInForce: null, correctedIds: new Set(), pendingCorrection: null, statusBeforeCorrection: null };

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
    case 'correction_requested':
      return { ...state, status: 'correction_pending', pendingCorrection: event, statusBeforeCorrection: state.status };
    case 'correction_withdrawn':
      // The sign-off in force was never invalidated: back to where it was.
      return { ...state, status: state.statusBeforeCorrection ?? state.status, pendingCorrection: null, statusBeforeCorrection: null };
    case 'release_corrected': {
      const correctedIds = new Set(state.correctedIds).add(event.correctsEventId ?? '');
      const inForce = state.signOffInForce?.eventId === event.correctsEventId;
      const cleared = { pendingCorrection: null, statusBeforeCorrection: null };
      if (inForce && (isReleasedStatus(state.status) || state.status === 'correction_pending')) return { ...state, ...cleared, status: 'on_hold', hold: event, signOffInForce: null, correctedIds };
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

/** Statuses in which the release is held — nothing may go to the crematory. */
export const isHeldStatus = (status: ReleaseStatus) => status === 'on_hold' || status === 'awaiting_reauthorization' || status === 'correction_pending';

/** The hold now in force (a hold, a correction that put the release on
    hold, or a correction awaiting confirmation), if any. */
export function currentHold(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseEvent | null {
  const state = releaseStateOf(record);
  if (state.status === 'correction_pending') return state.pendingCorrection;
  return state.status === 'on_hold' || state.status === 'awaiting_reauthorization' ? state.hold : null;
}

/** The correction awaiting independent confirmation, if any. */
export function pendingCorrection(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseEvent | null {
  return releaseStateOf(record).pendingCorrection;
}

/** The sign-off now in force (released / reauthorized, not corrected), if any. */
export function signOffInForce(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseEvent | null {
  return releaseStateOf(record).signOffInForce;
}

/**
 * The people responsible for a sign-off: the licensed director who signed
 * it, and whoever requested the release it signed (the nearest request
 * before it, unless that request was withdrawn).
 */
export function responsibleForSignOff(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined, signOffEventId: string): string[] {
  const events = releaseEventsOf(record);
  const index = events.findIndex((e) => e.eventId === signOffEventId);
  if (index < 0) return [];
  const ids = [events[index].actorId];
  for (let i = index - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'release_requested' || e.type === 'reauthorization_requested') {
      ids.push(e.actorId);
      break;
    }
    if (e.type !== 'hold_placed') break;
  }
  return ids;
}

/**
 * Why `actorId` may not confirm the pending correction — null when they
 * may. The confirming person must be someone other than whoever asked for
 * the correction, and other than the people responsible for the sign-off
 * being corrected.
 */
export function correctionConfirmationRefusal(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined, actorId: string): string | null {
  const request = pendingCorrection(record);
  if (!request) return 'No correction is awaiting confirmation.';
  if (request.actorId === actorId) return 'You asked for this correction, so someone else must confirm it.';
  if (responsibleForSignOff(record, request.correctsEventId ?? '').includes(actorId)) {
    return 'You were responsible for the release being corrected, so someone else must confirm it.';
  }
  return null;
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
