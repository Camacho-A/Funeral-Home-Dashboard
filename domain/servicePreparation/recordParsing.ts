import type { PreparationItemRecord, PreparationStatus, PreparationValueRecord, ReleaseForCremationRecord, ServicePreparationRecord } from './types';

/**
 * Reading the stored `servicePreparation` case field (Gus Phase 5C). Read
 * leniently, like `checklistCompletions`: a case without the field (every
 * case so far, every Manors case) has none; a malformed entry is dropped
 * rather than trusted; a malformed record as a whole is absent.
 */
const STATUSES: ReadonlySet<string> = new Set<PreparationStatus>(['pending', 'awaiting_confirmation', 'confirmed', 'completed', 'not_requested', 'attention_needed']);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function readValue(raw: unknown): PreparationValueRecord | null {
  if (!isObject(raw) || typeof raw.value !== 'string' || typeof raw.at !== 'string') return null;
  return { value: raw.value, at: raw.at, by: textOrNull(raw.by), byName: textOrNull(raw.byName) };
}

function readItem(raw: unknown): PreparationItemRecord | null {
  if (!isObject(raw) || typeof raw.status !== 'string' || !STATUSES.has(raw.status) || typeof raw.at !== 'string') return null;
  return {
    status: raw.status as PreparationStatus,
    forServiceStartAt: textOrNull(raw.forServiceStartAt),
    note: textOrNull(raw.note),
    documentId: textOrNull(raw.documentId),
    at: raw.at,
    by: textOrNull(raw.by),
    byName: textOrNull(raw.byName),
  };
}

function readMap<T>(raw: unknown, read: (value: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const entry = read(value);
    if (entry) out[key] = entry;
  }
  return out;
}

function readRelease(raw: unknown): ReleaseForCremationRecord | null {
  if (!isObject(raw) || typeof raw.releasedAt !== 'string' || typeof raw.releasedBy !== 'string' || typeof raw.roleKey !== 'string') return null;
  return { releasedAt: raw.releasedAt, releasedBy: raw.releasedBy, releasedByName: textOrNull(raw.releasedByName), roleKey: raw.roleKey };
}

export function readServicePreparationRecord(value: unknown): ServicePreparationRecord | null {
  if (!isObject(value) || typeof value.definitionKey !== 'string' || typeof value.definitionVersion !== 'number') return null;
  return {
    definitionKey: value.definitionKey,
    definitionVersion: value.definitionVersion,
    serviceAppointmentId: textOrNull(value.serviceAppointmentId),
    choices: readMap(value.choices, readValue),
    details: readMap(value.details, readValue),
    items: readMap(value.items, readItem),
    release: readRelease(value.release),
  };
}
