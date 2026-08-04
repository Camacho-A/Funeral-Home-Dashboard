import type { RecurrenceDefinition, RecurrenceFrequency } from '../types/recurrenceDefinition';

/**
 * Phase 27 (Scheduling & Resource Management). Standard mapper pair for
 * the `recurrenceDefinitions` collection. Deliberately no update/apply
 * function at all — mirrors `lib/wixSignatureRecordMapper.ts`'s own
 * insert-only convention exactly: a `RecurrenceDefinition`, once created,
 * is never edited. A changed pattern always creates a NEW row instead
 * (see services/scheduling/recurrenceEngine.ts).
 */

export type WixRecurrenceDefinitionItem = {
  beaconRecurrenceDefinitionId?: unknown;
  organizationId?: unknown;
  frequency?: unknown;
  interval?: unknown;
  byWeekday?: unknown;
  count?: unknown;
  until?: unknown;
  createdBy?: unknown;
  createdAt?: unknown;
};

const VALID_FREQUENCIES: readonly string[] = ['daily', 'weekly', 'monthly'];

function isFrequency(value: unknown): value is RecurrenceFrequency {
  return typeof value === 'string' && VALID_FREQUENCIES.includes(value);
}

function isNumberArrayOrNull(value: unknown): value is number[] | null {
  return value === null || (Array.isArray(value) && value.every((v) => typeof v === 'number'));
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixRecurrenceDefinitionItem(item: WixRecurrenceDefinitionItem | undefined): RecurrenceDefinition | null {
  if (
    !item ||
    typeof item.beaconRecurrenceDefinitionId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    !isFrequency(item.frequency) ||
    typeof item.interval !== 'number' ||
    !isNumberArrayOrNull(item.byWeekday) ||
    !isNumberOrNull(item.count) ||
    !isStringOrNull(item.until) ||
    typeof item.createdBy !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconRecurrenceDefinitionId,
    organizationId: item.organizationId,
    frequency: item.frequency,
    interval: item.interval,
    byWeekday: item.byWeekday,
    count: item.count,
    until: item.until,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
  };
}

export function buildWixRecurrenceDefinitionData(definition: RecurrenceDefinition): WixRecurrenceDefinitionItem {
  return {
    beaconRecurrenceDefinitionId: definition.id,
    organizationId: definition.organizationId,
    frequency: definition.frequency,
    interval: definition.interval,
    byWeekday: definition.byWeekday,
    count: definition.count,
    until: definition.until,
    createdBy: definition.createdBy,
    createdAt: definition.createdAt,
  };
}
