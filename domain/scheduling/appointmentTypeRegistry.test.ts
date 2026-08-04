import { describe, expect, it } from 'vitest';
import type { AppointmentTypeCategory } from './appointmentTypeRegistry';
import { APPOINTMENT_TYPES, getAppointmentTypeDefinition, isValidAppointmentTypeKey } from './appointmentTypeRegistry';

const CATEGORIES: AppointmentTypeCategory[] = ['family_facing', 'operational', 'internal'];

describe('APPOINTMENT_TYPES', () => {
  it('every entry has a distinct key', () => {
    const keys = Object.values(APPOINTMENT_TYPES).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry's displayName is never derived from (or equal to) its own dot-notation key", () => {
    for (const entry of Object.values(APPOINTMENT_TYPES)) {
      expect(entry.displayName).not.toBe(entry.key);
      expect(entry.displayName).not.toContain('.');
    }
  });

  it("every entry's category is one of the three defined categories", () => {
    for (const entry of Object.values(APPOINTMENT_TYPES)) {
      expect(CATEGORIES).toContain(entry.category);
    }
  });

  it('covers every one of the three categories with at least one entry', () => {
    const usedCategories = new Set(Object.values(APPOINTMENT_TYPES).map((entry) => entry.category));
    for (const category of CATEGORIES) {
      expect(usedCategories.has(category), `expected at least one appointment type in category "${category}"`).toBe(true);
    }
  });

  it('includes every appointment type named in the original spec', () => {
    const keys = Object.values(APPOINTMENT_TYPES).map((entry) => entry.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'arrangement.conference',
        'family.meeting',
        'viewing',
        'visitation',
        'funeral.service',
        'graveside.service',
        'witness.cremation',
        'crematory.appointment',
        'cemetery.appointment',
        'staff.meeting',
        'internal.event',
      ]),
    );
  });
});

describe('isValidAppointmentTypeKey / getAppointmentTypeDefinition', () => {
  it('recognizes a real key', () => {
    expect(isValidAppointmentTypeKey('viewing')).toBe(true);
    expect(getAppointmentTypeDefinition('viewing')?.displayName).toBe('Viewing');
  });

  it('rejects an unrecognized key', () => {
    expect(isValidAppointmentTypeKey('not.a.real.key')).toBe(false);
    expect(getAppointmentTypeDefinition('not.a.real.key')).toBeNull();
  });
});
