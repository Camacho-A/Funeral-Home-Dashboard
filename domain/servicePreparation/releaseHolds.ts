import { emptyPreparationRecord, PREPARATION_RECORD_MAX_BYTES, PreparationChangeError, PreparationLimitError, preparationRecordBytes } from './preparationUpdates';
import type { PreparationAuditEntry, ReleaseEvent, ReleaseEventType, ReleaseForCremationRecord, ServicePreparationDefinition, ServicePreparationRecord } from './types';

/**
 * The release-hold workflow (Gus, 2026-11): Released → On Hold →
 * Reauthorized, with operational requests waiting for a licensed
 * director's sign-off. Pure. Every step appends one event (and one history
 * entry) — nothing is edited or removed, and the original release
 * (`record.release`) is never overwritten.
 *
 * Who may do what is decided by the caller (services/cremationReleaseService.ts):
 * Administrators, Managers and Funeral Directors may request a release,
 * place a hold and request reauthorization; a `released` or `reauthorized`
 * event needs the licensed, authorized director's sign-off and every case
 * requirement rechecked at that moment.
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

const STATUS_AFTER: Record<ReleaseEventType, ReleaseStatus> = {
  release_requested: 'awaiting_signoff',
  released: 'released',
  hold_placed: 'on_hold',
  reauthorization_requested: 'awaiting_reauthorization',
  reauthorized: 'reauthorized',
};

/** The statuses each event may follow. */
export const RELEASE_EVENT_ALLOWED_FROM: Record<ReleaseEventType, readonly ReleaseStatus[]> = {
  release_requested: ['not_released'],
  released: ['not_released', 'awaiting_signoff'],
  hold_placed: ['released', 'reauthorized', 'awaiting_reauthorization'],
  reauthorization_requested: ['on_hold'],
  reauthorized: ['on_hold', 'awaiting_reauthorization'],
};

export class ReleaseTransitionError extends Error {}

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

export function releaseStatusOf(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseStatus {
  const last = releaseEventsOf(record).at(-1);
  return last ? STATUS_AFTER[last.type] : 'not_released';
}

/** Released and not on hold — the only state in which paperwork may go to the crematory. */
export const isReleasedStatus = (status: ReleaseStatus) => status === 'released' || status === 'reauthorized';

/** The hold now in force, if any. */
export function currentHold(record: Pick<ServicePreparationRecord, 'release' | 'releaseEvents'> | null | undefined): ReleaseEvent | null {
  const events = releaseEventsOf(record);
  if (!['on_hold', 'awaiting_reauthorization'].includes(releaseStatusOf(record))) return null;
  return [...events].reverse().find((e) => e.type === 'hold_placed') ?? null;
}

const TEXT_MAX = 300;

function describe(event: ReleaseEvent): string {
  const who = event.actorName ?? 'staff';
  switch (event.type) {
    case 'release_requested':
      return `Release for cremation requested by ${who} — awaiting a licensed director's sign-off`;
    case 'released':
      return `Released for cremation by ${who}${event.approval ? ` (${event.approval.licenseState} license ${event.approval.licenseNumber})` : ''}`;
    case 'hold_placed':
      return `Release placed on hold by ${who}: ${event.reason}${event.paperworkAlreadyTransmitted ? ' — paperwork had already been sent; the crematory must be contacted' : ''}`;
    case 'reauthorization_requested':
      return `Reauthorization requested by ${who} — awaiting a licensed director's sign-off`;
    case 'reauthorized':
      return `Release reauthorized by ${who}${event.approval ? ` (${event.approval.licenseState} license ${event.approval.licenseNumber})` : ''}`;
  }
}

/**
 * The record with `event` appended — refused unless the transition is
 * allowed from the current status, a hold has a reason, and a sign-off
 * carries its approval. The first `released` event is also kept, unchanged
 * forever, as `record.release`.
 */
export function appendReleaseEvent(params: { definition: ServicePreparationDefinition; record: ServicePreparationRecord | null; event: ReleaseEvent }): ServicePreparationRecord {
  const { definition } = params;
  if (params.record && params.record.definitionKey !== definition.key) throw new PreparationChangeError('This preparation belongs to a different service.');
  const status = releaseStatusOf(params.record);
  if (!RELEASE_EVENT_ALLOWED_FROM[params.event.type].includes(status)) {
    throw new ReleaseTransitionError(`This can't be done while the release is "${RELEASE_STATUS_LABEL[status]}".`);
  }
  const event: ReleaseEvent = { ...params.event, reason: params.event.reason?.trim() ? params.event.reason.trim().slice(0, TEXT_MAX) : null };
  if (event.type === 'hold_placed' && !event.reason) throw new ReleaseTransitionError('Give a reason for the hold.');
  if ((event.type === 'released' || event.type === 'reauthorized') && !event.approval) throw new ReleaseTransitionError("A licensed director's sign-off is required.");

  const record: ServicePreparationRecord = structuredClone(params.record ?? emptyPreparationRecord(definition, event.approval?.serviceAppointmentId ?? null));
  const previousEvents = releaseEventsOf(params.record);
  if (event.type === 'released' && !record.release) {
    const original: ReleaseForCremationRecord = {
      releasedAt: event.at,
      releasedBy: event.actorId,
      releasedByName: event.actorName,
      roleKey: event.roleKey,
      eventId: event.eventId,
      approval: event.approval ?? undefined,
    };
    record.release = original;
  }
  record.releaseEvents = [...previousEvents, event];
  const entry: PreparationAuditEntry = {
    eventId: event.eventId,
    target: { kind: 'release', key: event.type },
    description: describe(event),
    previous: previousEvents.at(-1) ?? null,
    next: event,
    actorId: event.actorId,
    actorName: event.actorName,
    at: event.at,
  };
  record.history = [...(record.history ?? []), entry];
  if (preparationRecordBytes(record) > PREPARATION_RECORD_MAX_BYTES) {
    throw new PreparationLimitError("This case's preparation record is full (including its history). Nothing was saved. Please contact SolisCode support.");
  }
  return record;
}
