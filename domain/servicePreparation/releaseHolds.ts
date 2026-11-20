import { emptyPreparationRecord, PREPARATION_RECORD_MAX_BYTES, PreparationChangeError, PreparationLimitError, preparationRecordBytes } from './preparationUpdates';
import type { PreparationAuditEntry, ReleaseEvent, ReleaseEventType, ReleaseForCremationRecord, ServicePreparationDefinition, ServicePreparationRecord } from './types';
import { correctableSignOffs, correctionConfirmationRefusal, pendingCorrection, pendingReleaseRequest, RELEASE_STATUS_LABEL, releaseEventsOf, releaseStatusOf, signOffInForce, isReleasedStatus, type ReleaseStatus } from './releaseStatus';

/**
 * The release-hold workflow (Gus, 2026-11): Released → On Hold →
 * Reauthorized, with operational requests waiting for a licensed
 * director's sign-off. Pure. Every step appends one event (and one history
 * entry) — nothing is edited or removed, and the original release
 * (`record.release`) is never overwritten.
 *
 * A pending request may be withdrawn (back to the status before it). A
 * wrong sign-off is corrected by appending a correction that references
 * it. A correction of the sign-off in force on an active release (Released
 * or Reauthorized) is first only requested — sending is blocked — and takes
 * effect when a different person confirms it: someone other than whoever
 * requested it and other than the people responsible for that sign-off.
 * Once confirmed the release is on hold and needs the normal
 * reauthorization with a licensed sign-off. A correction of any other
 * sign-off (not in force, or while already on hold) is recorded at once.
 *
 * Who may do what is decided by the caller (services/cremationReleaseService.ts):
 * Administrators, Managers and Funeral Directors may request a release,
 * place a hold and request reauthorization; a `released` or `reauthorized`
 * event needs the licensed, authorized director's sign-off and every case
 * requirement rechecked at that moment.
 */
export {
  RELEASE_STATUS_LABEL,
  releaseEventsOf,
  releaseStatusOf,
  isReleasedStatus,
  isHeldStatus,
  currentHold,
  pendingReleaseRequest,
  pendingCorrection,
  signOffInForce,
  correctableSignOffs,
  correctionConfirmationRefusal,
  responsibleForSignOff,
} from './releaseStatus';
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
  release_corrected: ['released', 'on_hold', 'awaiting_reauthorization', 'reauthorized', 'correction_pending'],
  correction_requested: ['released', 'reauthorized'],
  correction_withdrawn: ['correction_pending'],
};

/** Whether correcting this sign-off now affects an active release, and so needs independent confirmation. */
export function correctionNeedsConfirmation(record: ServicePreparationRecord | null, correctsEventId: string | null | undefined): boolean {
  return isReleasedStatus(releaseStatusOf(record)) && signOffInForce(record)?.eventId === correctsEventId;
}

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
      return `${event.confirmsEventId ? `Correction confirmed by ${who} — release on hold` : `Recorded sign-off corrected by ${who}`}: ${event.reason}${event.paperworkAlreadyTransmitted ? ' — paperwork had already been sent; the crematory must be contacted' : ''}`;
    case 'correction_requested':
      return `Correction of the release in force requested by ${who}: ${event.reason} — sending blocked until someone else confirms it${event.paperworkAlreadyTransmitted ? '; paperwork had already been sent, the crematory must be contacted' : ''}`;
    case 'correction_withdrawn':
      return `Correction request withdrawn by ${who}${event.reason ? `: ${event.reason}` : ''} — the release stands as signed`;
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
  if ((event.type === 'release_corrected' || event.type === 'correction_requested') && !correctableSignOffs(params.record).some((e) => e.eventId === event.correctsEventId)) {
    throw new ReleaseTransitionError('Only a recorded sign-off that has not already been corrected can be corrected.');
  }
  if (event.type === 'correction_requested') {
    if (!event.reason) throw new ReleaseTransitionError('Give a reason for the correction.');
    if (!correctionNeedsConfirmation(params.record, event.correctsEventId)) {
      throw new ReleaseTransitionError('Only a correction of the release in force needs confirmation; record this correction directly.');
    }
  }
  if (event.type === 'release_corrected') {
    const request = pendingCorrection(params.record);
    if (status === 'correction_pending') {
      // The only correction possible now is confirming the pending one, by someone independent.
      if (!request || event.confirmsEventId !== request.eventId || event.correctsEventId !== request.correctsEventId) {
        throw new ReleaseTransitionError('A correction is awaiting confirmation; confirm or withdraw it first.');
      }
      const refusal = correctionConfirmationRefusal(params.record, event.actorId);
      if (refusal) throw new ReleaseTransitionError(refusal);
    } else {
      if (event.confirmsEventId) throw new ReleaseTransitionError('No correction is awaiting confirmation.');
      if (correctionNeedsConfirmation(params.record, event.correctsEventId)) {
        throw new ReleaseTransitionError('Correcting the release in force needs confirmation by someone else; request the correction first.');
      }
    }
  }
  if (event.type === 'correction_withdrawn') {
    const request = pendingCorrection(params.record);
    event.withdrawsEventId = request?.eventId;
    // The person who asked may simply withdraw; anyone else declining it says why.
    if (request && request.actorId !== event.actorId && !event.reason) throw new ReleaseTransitionError('Give a reason for declining this correction.');
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
