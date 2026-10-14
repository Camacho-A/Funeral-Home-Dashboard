import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TYPE_ENABLED,
  IMPLEMENTED_NOTIFICATION_TYPES,
  NOTIFICATION_PREFERENCE_GROUPS,
  isTypeEnabled,
} from './notificationDefaults';
import { NOTIFICATION_TYPES, isValidNotificationTypeKey } from './notificationTypeRegistry';

describe('per-type defaults', () => {
  it('turns routine successes off and the failures nobody would otherwise see on', () => {
    // A PDF that imported is visible on the case; one that did not is
    // invisible until a family asks for it.
    expect(DEFAULT_TYPE_ENABLED[NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key]).toBe(false);
    expect(DEFAULT_TYPE_ENABLED[NOTIFICATION_TYPES.JOTFORM_PDF_IMPORT_FAILED.key]).toBe(true);
    expect(DEFAULT_TYPE_ENABLED[NOTIFICATION_TYPES.DOCUMENT_GENERATED.key]).toBe(false);
    expect(DEFAULT_TYPE_ENABLED[NOTIFICATION_TYPES.DOCUMENT_GENERATION_FAILED.key]).toBe(true);
  });

  it('has the day-to-day case and payment events on', () => {
    for (const key of [
      NOTIFICATION_TYPES.CASE_CREATED.key,
      NOTIFICATION_TYPES.CASE_ARRANGEMENT_RECEIVED.key,
      NOTIFICATION_TYPES.CASE_VITAL_STATISTICS_RECEIVED.key,
      NOTIFICATION_TYPES.CASE_COMPLETED.key,
      NOTIFICATION_TYPES.INTAKE_SUBMISSION_NEEDS_ATTENTION.key,
      NOTIFICATION_TYPES.PAYMENT_RECEIVED.key,
      NOTIFICATION_TYPES.PAYMENT_FAILED.key,
    ]) {
      expect(DEFAULT_TYPE_ENABLED[key]).toBe(true);
    }
  });

  it('only offers types that really exist', () => {
    for (const key of IMPLEMENTED_NOTIFICATION_TYPES) {
      expect(isValidNotificationTypeKey(key)).toBe(true);
    }
  });

  it('gives every offered type a label and an explanation', () => {
    for (const group of NOTIFICATION_PREFERENCE_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      for (const type of group.types) {
        expect(type.label.length).toBeGreaterThan(0);
        expect(type.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('lists each type once', () => {
    expect(new Set(IMPLEMENTED_NOTIFICATION_TYPES).size).toBe(IMPLEMENTED_NOTIFICATION_TYPES.length);
  });
});

describe('isTypeEnabled', () => {
  it('uses the default when the person has never said', () => {
    expect(isTypeEnabled({}, NOTIFICATION_TYPES.CASE_CREATED.key)).toBe(true);
    expect(isTypeEnabled({}, NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key)).toBe(false);
  });

  it('honours an explicit choice in both directions', () => {
    expect(isTypeEnabled({ [NOTIFICATION_TYPES.CASE_CREATED.key]: false }, NOTIFICATION_TYPES.CASE_CREATED.key)).toBe(false);
    expect(
      isTypeEnabled({ [NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key]: true }, NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key),
    ).toBe(true);
  });

  it('separates the two halves of a category, which is the whole point', () => {
    // Turning off successful imports must not take failures with it.
    const prefs = { [NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key]: false };
    expect(isTypeEnabled(prefs, NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key)).toBe(false);
    expect(isTypeEnabled(prefs, NOTIFICATION_TYPES.JOTFORM_PDF_IMPORT_FAILED.key)).toBe(true);
  });

  it('leaves tasks, scheduling and system types governed as they always were', () => {
    // These predate per-type control and have no default here; they must
    // keep flowing through the category and global switches alone.
    expect(isTypeEnabled({}, NOTIFICATION_TYPES.TASK_ASSIGNED.key)).toBe(true);
    expect(isTypeEnabled({}, NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT.key)).toBe(true);
    expect(isTypeEnabled({}, NOTIFICATION_TYPES.APPOINTMENT_REMINDER.key)).toBe(true);
  });

  it('treats an existing preference row with no per-type choices as unchanged', () => {
    // The migration story: rows written before this feature have {}.
    for (const key of IMPLEMENTED_NOTIFICATION_TYPES) {
      expect(isTypeEnabled({}, key)).toBe(DEFAULT_TYPE_ENABLED[key]);
    }
  });
});
