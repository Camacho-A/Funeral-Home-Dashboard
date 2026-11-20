import { emptyPreparationRecord, PREPARATION_RECORD_MAX_BYTES, PreparationChangeError, PreparationLimitError, preparationRecordBytes } from './preparationUpdates';
import type { PreparationAuditEntry, ReleaseEvent, ReleaseEventType, ReleaseForCremationRecord, ServicePreparationDefinition, ServicePreparationRecord } from './types';
import { correctableSignOffs, pendingReleaseRequest, RELEASE_STATUS_LABEL, releaseEventsOf, releaseStatusOf, type ReleaseStatus } from './releaseStatus';

/**
 * The release-hold workflow (Gus, 2026-11): Released → On Hold →
 * Reauthorized, with operational requests waiting for a licensed
 * director's sign-off. Pure. Every step appends one event (and one history
 * entry) — nothing is edited or removed, and the original release
 * (`record.release`) is never overwritten.
 *
 * A pending request may be withdrawn (back to the status before it). A
 * wrong sign-off is corrected by appending a correction that references
 * it; if it is the sign-off in force, the release goes on hold and needs
 * the normal reauthorization with a licensed sign-off.
 *
 * Who may do what is decided by the caller (services/cremationReleaseService.ts):
 * Administrators, Managers and Funeral Directors may request a release,
 * place a hold and request reauthorization; a `released` or `reauthorized`
 * event needs the licensed, authorized director's sign-off and every case
 * requirement rechecked at that moment.
 */
export { RELEASE_STATUS_LABEL, releaseEventsOf, releaseStatusOf, isReleasedStatus, currentHold, pendingReleaseRequest, correctableSignOffs } from './releaseStatus';
export type { ReleaseStatus } from './releaseStatus';

/** The statuses each event may follow. */
export const RELEASE_EVENT_ALLOWED_FROM: Record<ReleaseEventType, readonly ReleaseStatus[]> = {
  release_requested: ['not_released'],
  released: ['not_released', 'awaiting_signoff'],
  hold_placed: ['released', 'reauthorized', 'awaiting_reauthorization'],
  reauthorization_requested: ['on_hold'],
  reauthorized: ['on_hold', 'awaiting_reauthorization'],
  request_withdrawn: ['awaiting_signoff', 'awaiting_reauthorization'],
  // Which sign-off it may correct is checked against the events themselves.
  release_corrected: ['released', 'on_hold', 'awaiting_reauthorization', 'reauthorized'],
};

export class ReleaseTransitionError extends Error {}

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
    case 'request_withdrawn':
      return `Pending request withdrawn by ${who}${event.reason ? `: ${event.reason}` : ''}`;
    case 'release_corrected':
      return `Recorded sign-off corrected by ${who}: ${event.reason}${event.paperworkAlreadyTransmitted ? ' — paperwork had already been sent; the crematory must be contacted' : ''}`;
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
  if (event.type === 'release_corrected' && !event.reason) throw new ReleaseTransitionError('Give a reason for the correction.');
  if ((event.type === 'released' || event.type === 'reauthorized') && !event.approval) throw new ReleaseTransitionError("A licensed director's sign-off is required.");
  if (event.type === 'request_withdrawn') {
    // Always the request pending now — never an older one.
    event.withdrawsEventId = pendingReleaseRequest(params.record)?.eventId;
  }
  if (event.type === 'release_corrected' && !correctableSignOffs(params.record).some((e) => e.eventId === event.correctsEventId)) {
    throw new ReleaseTransitionError('Only a recorded sign-off that has not already been corrected can be corrected.');
  }

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
