import { describe, it, expect } from 'vitest';
import { mapWixRecurrenceDefinitionItem, buildWixRecurrenceDefinitionData } from './wixRecurrenceDefinitionMapper';
import type { RecurrenceDefinition } from '../types/recurrenceDefinition';

const DEFINITION: RecurrenceDefinition = {
  id: 'recurrence-1',
  organizationId: 'org-1',
  frequency: 'weekly',
  interval: 1,
  byWeekday: [2, 4],
  count: 8,
  until: null,
  createdBy: 'identity-1',
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('wixRecurrenceDefinitionMapper', () => {
  it('round-trips a weekly definition with byWeekday/count', () => {
    expect(mapWixRecurrenceDefinitionItem(buildWixRecurrenceDefinitionData(DEFINITION))).toEqual(DEFINITION);
  });

  it('round-trips a monthly definition with until instead of count', () => {
    const monthly: RecurrenceDefinition = { ...DEFINITION, frequency: 'monthly', byWeekday: null, count: null, until: '2027-08-01T00:00:00.000Z' };
    expect(mapWixRecurrenceDefinitionItem(buildWixRecurrenceDefinitionData(monthly))).toEqual(monthly);
  });

  it('returns null for undefined', () => {
    expect(mapWixRecurrenceDefinitionItem(undefined)).toBeNull();
  });

  it('returns null for an invalid frequency', () => {
    expect(mapWixRecurrenceDefinitionItem({ ...buildWixRecurrenceDefinitionData(DEFINITION), frequency: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixRecurrenceDefinitionItem({ ...buildWixRecurrenceDefinitionData(DEFINITION), interval: '1' })).toBeNull();
  });

  it('exposes no update/apply function — insert-only by construction', async () => {
    const moduleExports = await import('./wixRecurrenceDefinitionMapper');
    const exportNames = Object.keys(moduleExports);
    expect(exportNames.some((name) => /^apply/i.test(name))).toBe(false);
  });
});
