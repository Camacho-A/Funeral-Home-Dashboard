import type { PreparationStatus, ServiceEvent, ServicePreparationDefinition, ServicePreparationRecord } from './types';

/**
 * The rules a preparation change must pass (Gus Phase 5B, 2026-11) — for
 * the server route that will store preparation once the
 * `servicePreparation` case field is approved (docs/SERVICE_PREPARATION.md).
 * No route uses this yet.
 *
 * - Only this service's own preparation ids and choices are accepted: a
 *   change can never name a workflow or legal step (`cremation.…`).
 * - An item is keyed by its id, so recording it again replaces its latest
 *   state — it is never added twice. Earlier states go to Activity.
 * - A required item cannot be marked Not requested.
 * - A date-dependent confirmation records the service start it is for, so
 *   a reschedule shows it as needing confirmation again.
 */
export type PreparationChange =
  | { kind: 'item'; itemId: string; status: PreparationStatus; note?: string | null }
  | { kind: 'choice'; choice: string; value: string }
  | { kind: 'detail'; key: string; value: string };

export class PreparationChangeError extends Error {}

const MAX_TEXT = 300;

export function emptyPreparationRecord(definition: ServicePreparationDefinition, serviceAppointmentId: string | null = null): ServicePreparationRecord {
  return { definitionKey: definition.key, definitionVersion: definition.version, serviceAppointmentId, choices: {}, details: {}, items: {}, release: null };
}

export function applyPreparationChange(params: {
  definition: ServicePreparationDefinition;
  record: ServicePreparationRecord | null;
  service: ServiceEvent | null;
  change: PreparationChange;
  actor: { id: string; name: string | null };
  now: string;
}): ServicePreparationRecord {
  const { definition, change } = params;
  if (params.record && params.record.definitionKey !== definition.key) {
    throw new PreparationChangeError('This preparation belongs to a different service.');
  }
  const record: ServicePreparationRecord = structuredClone(params.record ?? emptyPreparationRecord(definition, params.service?.appointmentId ?? null));
  if (params.record?.release) throw new PreparationChangeError('The remains were already released for cremation; preparation can no longer change.');

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
    const note = change.note?.trim() ? change.note.trim().slice(0, MAX_TEXT) : null;
    record.items[item.id] = {
      status: change.status,
      forServiceStartAt: item.dateDependent && recordsADate ? (params.service as ServiceEvent).startAt : null,
      note,
      at: params.now,
      by: params.actor.id,
      byName: params.actor.name,
    };
  } else if (change.kind === 'choice') {
    const choice = definition.choices.find((c) => c.key === change.choice);
    if (!choice || !choice.options.some((o) => o.value === change.value)) {
      throw new PreparationChangeError(`"${change.value}" is not an answer to "${choice?.label ?? change.choice}".`);
    }
    record.choices[choice.key] = change.value;
  } else {
    const known = definition.groups.flatMap((g) => g.details ?? []).find((d) => d.key === change.key);
    if (!known) throw new PreparationChangeError(`"${change.key}" is not a detail of the ${definition.serviceName} preparation.`);
    if (known.kind === 'select' && !known.options?.some((o) => o.value === change.value)) {
      throw new PreparationChangeError(`"${change.value}" is not an option for ${known.label}.`);
    }
    record.details[known.key] = change.value.trim().slice(0, MAX_TEXT);
  }
  if (params.service) record.serviceAppointmentId = params.service.appointmentId;
  return record;
}
