import type { PreparationAuditEntry, PreparationItemRecord, PreparationStatus, PreparationValueRecord, ServiceEvent, ServicePreparationDefinition, ServicePreparationRecord } from './types';

/**
 * The rules every preparation change passes (Gus Phase 5B/5C, 2026-11),
 * used by services/servicePreparationService.ts on the server.
 *
 * - Only this service's own preparation ids, choices and details are
 *   accepted: a change can never name a workflow or legal step
 *   (`cremation.…`), so it can never authorize cremation, complete a
 *   permit or medical examiner step, send anything or move the workflow.
 * - An item is keyed by its id, so recording it again replaces its latest
 *   state — it is never added twice. The earlier state goes to Activity.
 * - A required item cannot be marked Not requested.
 * - A date-dependent confirmation records the service start it is for, so
 *   a reschedule shows it as needing confirmation again.
 * - Concurrent staff: a change says what it was made against (`basis`). If
 *   someone else changed THAT item, choice or detail since, it is refused
 *   (PreparationConflictError) rather than silently overwriting them.
 *   Changes to anything else merge.
 * - Audit (Phase 5E): every change appends one entry to the record's own
 *   `history` — what changed, before and after, who, when, and a
 *   server-generated event id — so the change and its audit entry are
 *   saved together or not at all. History is never trimmed: a change that
 *   would take the record past PREPARATION_RECORD_MAX_BYTES is refused
 *   (PreparationLimitError) and nothing is saved.
 */
export type PreparationChange =
  | { kind: 'item'; itemId: string; status: PreparationStatus; note?: string | null; documentId?: string | null }
  | { kind: 'choice'; choice: string; value: string }
  | { kind: 'detail'; key: string; value: string };

/** What the person saw before making the change: the `at` of the item,
    choice or detail they changed, or null when it had never been set. */
export type PreparationChangeBasis = { at: string | null };

export class PreparationChangeError extends Error {}
export class PreparationConflictError extends Error {}
/** The record (with its history) would be too large to save safely. */
export class PreparationLimitError extends Error {}

/** Well under the 512 KB Wix item limit, leaving room for the rest of the
    case row (workflow snapshot, checklist, crematory record). A typical
    service is far below it: each history entry is a few hundred bytes. */
export const PREPARATION_RECORD_MAX_BYTES = 128 * 1024;

export function preparationRecordBytes(record: ServicePreparationRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).length;
}

export const PREPARATION_TEXT_MAX = 300;

export function emptyPreparationRecord(definition: ServicePreparationDefinition, serviceAppointmentId: string | null = null): ServicePreparationRecord {
  return { definitionKey: definition.key, definitionVersion: definition.version, serviceAppointmentId, choices: {}, details: {}, items: {}, release: null, history: [] };
}

/** The current entry a change targets (for the conflict check and Activity). */
export function currentEntryFor(record: ServicePreparationRecord | null, change: PreparationChange): PreparationItemRecord | PreparationValueRecord | null {
  if (!record) return null;
  if (change.kind === 'item') return record.items[change.itemId] ?? null;
  if (change.kind === 'choice') return record.choices[change.choice] ?? null;
  return record.details[change.key] ?? null;
}

function clean(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, PREPARATION_TEXT_MAX) : null;
}

export function applyPreparationChange(params: {
  definition: ServicePreparationDefinition;
  record: ServicePreparationRecord | null;
  service: ServiceEvent | null;
  change: PreparationChange;
  /** Omitted only by callers with no one to conflict with (tests, a first write). */
  basis?: PreparationChangeBasis;
  actor: { id: string; name: string | null };
  now: string;
  /** Server-generated, unique per change; recorded in the history entry. */
  eventId: string;
}): ServicePreparationRecord {
  const { definition, change } = params;
  if (params.record && params.record.definitionKey !== definition.key) {
    throw new PreparationChangeError('This preparation belongs to a different service.');
  }
  if (params.record?.release) throw new PreparationChangeError('The remains were already released for cremation; preparation can no longer change.');
  if (params.basis) {
    const current = currentEntryFor(params.record, change);
    if ((current?.at ?? null) !== params.basis.at) {
      throw new PreparationConflictError('Someone else changed this while you were working on it. The latest is shown — please check it and try again.');
    }
  }
  const record: ServicePreparationRecord = structuredClone(params.record ?? emptyPreparationRecord(definition, params.service?.appointmentId ?? null));
  const stamp = { at: params.now, by: params.actor.id, byName: params.actor.name };

  if (change.kind === 'item') {
    const item = definition.groups.flatMap((g) => g.items).find((i) => i.id === change.itemId);
    if (!item) throw new PreparationChangeError(`"${change.itemId}" is not part of the ${definition.serviceName} preparation.`);
    if (change.status === 'not_requested' && item.requirement !== 'optional') {
      throw new PreparationChangeError(`"${item.label}" is required and cannot be marked Not requested.`);
    }
    const recordsADate = change.status === 'awaiting_confirmation' || change.status === 'confirmed' || change.status === 'completed';
    if (item.dateDependent && recordsADate && !params.service) {
      throw new PreparationChangeError(`Schedule the ${definition.serviceName.toLowerCase()} first: "${item.label}" is for a date and time.`);
    }
    const previous = record.items[item.id];
    record.items[item.id] = {
      status: change.status,
      forServiceStartAt: item.dateDependent && recordsADate ? (params.service as ServiceEvent).startAt : null,
      // A status change keeps the note and document unless they are changed too.
      note: change.note === undefined ? (previous?.note ?? null) : clean(change.note),
      documentId: change.documentId === undefined ? (previous?.documentId ?? null) : change.documentId,
      ...stamp,
    };
  } else if (change.kind === 'choice') {
    const choice = definition.choices.find((c) => c.key === change.choice);
    if (!choice || !choice.options.some((o) => o.value === change.value)) {
      throw new PreparationChangeError(`"${change.value}" is not an answer to "${choice?.label ?? change.choice}".`);
    }
    record.choices[choice.key] = { value: change.value, ...stamp };
  } else {
    const known = definition.groups.flatMap((g) => g.details ?? []).find((d) => d.key === change.key);
    if (!known) throw new PreparationChangeError(`"${change.key}" is not a detail of the ${definition.serviceName} preparation.`);
    if (known.kind === 'select' && !known.options?.some((o) => o.value === change.value)) {
      throw new PreparationChangeError(`"${change.value}" is not an option for ${known.label}.`);
    }
    record.details[known.key] = { value: clean(change.value) ?? '', ...stamp };
  }
  if (params.service) record.serviceAppointmentId = params.service.appointmentId;

  const target = targetOf(change);
  const entry: PreparationAuditEntry = {
    eventId: params.eventId,
    target,
    description: describePreparationChange(definition, change),
    previous: currentEntryFor(params.record, change),
    next: currentEntryFor(record, change) as PreparationItemRecord | PreparationValueRecord,
    actorId: params.actor.id,
    actorName: params.actor.name,
    at: params.now,
  };
  record.history = [...(record.history ?? []), entry];

  const bytes = preparationRecordBytes(record);
  if (bytes > PREPARATION_RECORD_MAX_BYTES) {
    throw new PreparationLimitError(
      `This case's preparation record is full (${Math.ceil(bytes / 1024)} KB of ${PREPARATION_RECORD_MAX_BYTES / 1024} KB, including its history). Nothing was saved. Please contact SolisCode support.`,
    );
  }
  return record;
}

export function targetOf(change: PreparationChange): PreparationAuditEntry['target'] {
  if (change.kind === 'item') return { kind: 'item', key: change.itemId };
  if (change.kind === 'choice') return { kind: 'choice', key: change.choice };
  return { kind: 'detail', key: change.key };
}

/** Plain-language summary of a change, for Activity. */
export function describePreparationChange(definition: ServicePreparationDefinition, change: PreparationChange): string {
  if (change.kind === 'item') {
    const item = definition.groups.flatMap((g) => g.items).find((i) => i.id === change.itemId);
    return `${definition.serviceName} preparation: "${item?.label ?? change.itemId}" set to ${change.status.replace(/_/g, ' ')}`;
  }
  if (change.kind === 'choice') {
    const choice = definition.choices.find((c) => c.key === change.choice);
    const answer = choice?.options.find((o) => o.value === change.value)?.label ?? change.value;
    return `${definition.serviceName} preparation: ${choice?.label ?? change.choice} — ${answer}`;
  }
  const detail = definition.groups.flatMap((g) => g.details ?? []).find((d) => d.key === change.key);
  return `${definition.serviceName} preparation: ${detail?.label ?? change.key} updated`;
}
