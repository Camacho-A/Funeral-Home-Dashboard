import type { DataAdapterMode } from '../../lib/env';
import { insertWixDataItem } from '../../lib/wixDataApi';
import { buildWixRecurrenceDefinitionData, type WixRecurrenceDefinitionItem } from '../../lib/wixRecurrenceDefinitionMapper';
import type { RecurrenceDefinition, NewRecurrenceDefinitionInput } from '../../types/recurrenceDefinition';
import { recurrenceDefinitionFixtures } from '../__mocks__/schedulingFixtures';

/**
 * Phase 27 (Scheduling & Resource Management). Imported only by
 * `services/schedulingService.ts` (structurally enforced — see that
 * file's own test). This module owns exactly one write: inserting a new,
 * immutable `RecurrenceDefinition` row — it never writes an `Appointment`
 * row itself. Occurrence materialization is a pure date-math function
 * (`computeOccurrences`); `schedulingService.ts` is the one that actually
 * persists each computed occurrence as its own `Appointment` row,
 * preserving the invariant that only `resourceService.ts`/
 * `schedulingService.ts` ever write to the mutable scheduling
 * collections.
 *
 * **`RecurrenceDefinition` is genuinely immutable.** This file imports
 * only `insertWixDataItem` from `lib/wixDataApi.ts` for the
 * `recurrenceDefinitions` collection — never `updateWixDataItem` — and
 * `lib/wixRecurrenceDefinitionMapper.ts` itself exposes no update/apply
 * function at all (mirroring `SignatureRecord`'s own insert-only
 * precedent). A changed recurrence pattern always creates a NEW
 * `RecurrenceDefinition`; existing materialized occurrences keep pointing
 * at the original.
 */
export class RecurrenceEngineError extends Error {}

/** Explicit, documented materialization cap — never silently truncated.
    Whichever bound is reached first stops materialization; the caller
    (schedulingService.ts) surfaces how many occurrences were actually
    created. */
export const MATERIALIZATION_CAP_COUNT = 104;
export const MATERIALIZATION_CAP_YEARS = 2;

function nowIso(): string {
  return new Date().toISOString();
}

export async function createRecurrenceDefinition(
  organizationId: string,
  params: NewRecurrenceDefinitionInput & { createdBy: string; idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<RecurrenceDefinition> {
  if (params.count === undefined && params.until === undefined) {
    throw new RecurrenceEngineError('A recurrence definition must specify either a count or an until date.');
  }
  if (params.count !== undefined && params.until !== undefined) {
    throw new RecurrenceEngineError('A recurrence definition may specify count or until, never both.');
  }
  if (params.frequency === 'weekly' && params.byWeekday !== undefined && params.byWeekday.length === 0) {
    throw new RecurrenceEngineError('byWeekday, if provided, must name at least one weekday.');
  }

  const definition: RecurrenceDefinition = {
    id: params.idFactory(),
    organizationId,
    frequency: params.frequency,
    interval: params.interval,
    byWeekday: params.byWeekday ?? null,
    count: params.count ?? null,
    until: params.until ?? null,
    createdBy: params.createdBy,
    createdAt: params.now ?? nowIso(),
  };

  if (dataAdapterMode === 'mock') {
    recurrenceDefinitionFixtures.push(definition);
    return definition;
  }
  await insertWixDataItem<WixRecurrenceDefinitionItem>('recurrenceDefinitions', buildWixRecurrenceDefinitionData(definition), definition.id);
  return definition;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** Pure date-math — computes every occurrence's `{startAt, endAt}`,
    starting with the first occurrence itself at index 0, capped at
    `MATERIALIZATION_CAP_COUNT` occurrences or `MATERIALIZATION_CAP_YEARS`
    out from the first occurrence, whichever is reached first. Never
    called at read time — `schedulingService.ts` calls this once, at
    creation time, and persists each result as its own `Appointment` row. */
export function computeOccurrences(definition: RecurrenceDefinition, firstStartAt: string, firstEndAt: string): Array<{ startAt: string; endAt: string }> {
  const firstStart = new Date(firstStartAt);
  const firstEnd = new Date(firstEndAt);
  const durationMs = firstEnd.getTime() - firstStart.getTime();
  const horizon = new Date(firstStart);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + MATERIALIZATION_CAP_YEARS);
  const until = definition.until ? new Date(definition.until) : null;
  const maxCount = definition.count ?? MATERIALIZATION_CAP_COUNT;

  const starts: Date[] = [];

  if (definition.frequency === 'weekly' && definition.byWeekday && definition.byWeekday.length > 0) {
    const weekdays = [...definition.byWeekday].sort((a, b) => a - b);
    let weekBlockStart = new Date(firstStart);
    weekBlockStart.setUTCDate(weekBlockStart.getUTCDate() - weekBlockStart.getUTCDay());

    outer: while (starts.length < MATERIALIZATION_CAP_COUNT && starts.length < maxCount) {
      for (const weekday of weekdays) {
        const candidate = addDays(weekBlockStart, weekday);
        if (candidate.getTime() < firstStart.getTime()) continue;
        if (candidate.getTime() > horizon.getTime()) break outer;
        if (until && candidate.getTime() > until.getTime()) break outer;
        starts.push(candidate);
        if (starts.length >= MATERIALIZATION_CAP_COUNT || starts.length >= maxCount) break outer;
      }
      weekBlockStart = addDays(weekBlockStart, 7 * definition.interval);
    }
  } else {
    let candidate = new Date(firstStart);
    while (starts.length < MATERIALIZATION_CAP_COUNT && starts.length < maxCount) {
      if (candidate.getTime() > horizon.getTime()) break;
      if (until && candidate.getTime() > until.getTime()) break;
      starts.push(new Date(candidate));
      candidate = definition.frequency === 'daily' ? addDays(candidate, definition.interval) : definition.frequency === 'monthly' ? addMonths(candidate, definition.interval) : addDays(candidate, 7 * definition.interval);
    }
  }

  return starts.map((start) => ({ startAt: start.toISOString(), endAt: new Date(start.getTime() + durationMs).toISOString() }));
}
