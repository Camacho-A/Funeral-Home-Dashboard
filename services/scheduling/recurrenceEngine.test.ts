import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRecurrenceDefinition, computeOccurrences, RecurrenceEngineError, MATERIALIZATION_CAP_COUNT, MATERIALIZATION_CAP_YEARS } from './recurrenceEngine';
import { recurrenceDefinitionFixtures } from '../__mocks__/schedulingFixtures';
import { DEFAULT_ORGANIZATION_ID } from '../__mocks__/organizationIds';
import type { RecurrenceDefinition } from '../../types/recurrenceDefinition';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `recurrence-${idCounter}`;
}

beforeEach(() => {
  idCounter = 0;
  recurrenceDefinitionFixtures.length = 0;
});

afterEach(() => {
  recurrenceDefinitionFixtures.length = 0;
});

describe('createRecurrenceDefinition', () => {
  it('creates a weekly definition with a fixed count', async () => {
    const definition = await createRecurrenceDefinition(DEFAULT_ORGANIZATION_ID, { frequency: 'weekly', interval: 1, count: 4, createdBy: 'identity-1', idFactory }, 'mock');
    expect(definition.frequency).toBe('weekly');
    expect(definition.count).toBe(4);
    expect(definition.until).toBeNull();
  });

  it('requires exactly one of count/until', async () => {
    await expect(createRecurrenceDefinition(DEFAULT_ORGANIZATION_ID, { frequency: 'weekly', interval: 1, createdBy: 'identity-1', idFactory }, 'mock')).rejects.toThrow(RecurrenceEngineError);
    await expect(
      createRecurrenceDefinition(DEFAULT_ORGANIZATION_ID, { frequency: 'weekly', interval: 1, count: 4, until: '2026-12-31T00:00:00.000Z', createdBy: 'identity-1', idFactory }, 'mock'),
    ).rejects.toThrow(RecurrenceEngineError);
  });

  it('rejects an empty byWeekday array', async () => {
    await expect(
      createRecurrenceDefinition(DEFAULT_ORGANIZATION_ID, { frequency: 'weekly', interval: 1, count: 4, byWeekday: [], createdBy: 'identity-1', idFactory }, 'mock'),
    ).rejects.toThrow(RecurrenceEngineError);
  });
});

describe('computeOccurrences', () => {
  function def(overrides: Partial<RecurrenceDefinition> = {}): RecurrenceDefinition {
    return {
      id: 'def-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      frequency: 'weekly',
      interval: 1,
      byWeekday: null,
      count: 4,
      until: null,
      createdBy: 'identity-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('computes N weekly occurrences, including the first, preserving duration', () => {
    const occurrences = computeOccurrences(def({ count: 4 }), '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z');
    expect(occurrences).toHaveLength(4);
    expect(occurrences[0].startAt).toBe('2026-09-01T14:00:00.000Z');
    expect(occurrences[1].startAt).toBe('2026-09-08T14:00:00.000Z');
    expect(occurrences[3].startAt).toBe('2026-09-22T14:00:00.000Z');
    for (const occ of occurrences) {
      expect(new Date(occ.endAt).getTime() - new Date(occ.startAt).getTime()).toBe(60 * 60 * 1000);
    }
  });

  it('computes daily occurrences at the given interval', () => {
    const occurrences = computeOccurrences(def({ frequency: 'daily', interval: 2, count: 3 }), '2026-09-01T09:00:00.000Z', '2026-09-01T09:30:00.000Z');
    expect(occurrences.map((o) => o.startAt)).toEqual(['2026-09-01T09:00:00.000Z', '2026-09-03T09:00:00.000Z', '2026-09-05T09:00:00.000Z']);
  });

  it('computes monthly occurrences at the given interval', () => {
    const occurrences = computeOccurrences(def({ frequency: 'monthly', interval: 1, count: 3 }), '2026-09-15T09:00:00.000Z', '2026-09-15T10:00:00.000Z');
    expect(occurrences.map((o) => o.startAt)).toEqual(['2026-09-15T09:00:00.000Z', '2026-10-15T09:00:00.000Z', '2026-11-15T09:00:00.000Z']);
  });

  it('computes weekly occurrences on specific weekdays (byWeekday)', () => {
    // 2026-09-01 is a Tuesday (day 2). byWeekday [2, 4] = Tuesday, Thursday.
    const occurrences = computeOccurrences(def({ byWeekday: [2, 4], count: 4 }), '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z');
    expect(occurrences).toHaveLength(4);
    expect(new Date(occurrences[0].startAt).getUTCDay()).toBe(2);
    expect(new Date(occurrences[1].startAt).getUTCDay()).toBe(4);
    expect(new Date(occurrences[2].startAt).getUTCDay()).toBe(2);
    expect(new Date(occurrences[3].startAt).getUTCDay()).toBe(4);
  });

  it('stops at an explicit until date', () => {
    const occurrences = computeOccurrences(def({ count: null, until: '2026-09-15T00:00:00.000Z' }), '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z');
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occ of occurrences) {
      expect(new Date(occ.startAt).getTime()).toBeLessThanOrEqual(new Date('2026-09-15T00:00:00.000Z').getTime());
    }
  });

  it('never exceeds the explicit materialization cap, even when count asks for more', () => {
    const occurrences = computeOccurrences(def({ frequency: 'daily', interval: 1, count: 999 }), '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z');
    expect(occurrences.length).toBeLessThanOrEqual(MATERIALIZATION_CAP_COUNT);
  });

  it('never exceeds the 2-year horizon, even when count asks for more', () => {
    const occurrences = computeOccurrences(def({ frequency: 'monthly', interval: 1, count: 999 }), '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z');
    const horizon = new Date('2026-09-01T14:00:00.000Z');
    horizon.setUTCFullYear(horizon.getUTCFullYear() + MATERIALIZATION_CAP_YEARS);
    for (const occ of occurrences) {
      expect(new Date(occ.startAt).getTime()).toBeLessThanOrEqual(horizon.getTime());
    }
  });
});

describe('RecurrenceDefinition immutability (structural)', () => {
  it('recurrenceEngine.ts imports only insertWixDataItem from lib/wixDataApi.ts for recurrenceDefinitions, never updateWixDataItem/deleteWixDataItem', () => {
    const source = readFileSync(join(__dirname, 'recurrenceEngine.ts'), 'utf8');
    const importLine = source.split('\n').find((line) => line.includes("from '../../lib/wixDataApi'"));
    expect(importLine).toBeTruthy();
    expect(importLine).toContain('insertWixDataItem');
    expect(importLine).not.toContain('updateWixDataItem');
    expect(importLine).not.toContain('deleteWixDataItem');
    expect(source).not.toContain('updateWixDataItem(');
    expect(source).not.toContain('deleteWixDataItem(');
  });

  it('lib/wixRecurrenceDefinitionMapper.ts exposes no update/apply function', async () => {
    const moduleExports = await import('../../lib/wixRecurrenceDefinitionMapper');
    const exportNames = Object.keys(moduleExports);
    expect(exportNames.some((name) => /^apply/i.test(name))).toBe(false);
  });
});
