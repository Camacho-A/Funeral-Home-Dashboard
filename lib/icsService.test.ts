import { describe, expect, it } from 'vitest';
import { buildIcsCalendar, buildSingleEventIcs, type IcsEventInput } from './icsService';

const BASE_EVENT: IcsEventInput = {
  appointmentId: 'appt-1',
  title: 'Viewing',
  description: 'Family viewing for Robert Ellison',
  location: '123 Main St, Springfield',
  startAt: '2026-09-10T14:00:00.000Z',
  endAt: '2026-09-10T15:00:00.000Z',
  status: 'confirmed',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('buildIcsCalendar', () => {
  it('produces a well-formed VCALENDAR wrapper with the expected required properties', () => {
    const ics = buildIcsCalendar('Dana — Beacon', [BASE_EVENT], '2026-09-05T00:00:00.000Z');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Beacon//Scheduling//EN');
    expect(ics).toContain('X-WR-CALNAME:Dana — Beacon');
  });

  it('emits a deterministic, stable UID keyed only by the appointment id', () => {
    const ics = buildIcsCalendar('cal', [BASE_EVENT]);
    expect(ics).toContain('UID:beacon-appointment-appt-1@beacon.app');
  });

  it('emits UTC-form DTSTART/DTEND derived from the ISO instants', () => {
    const ics = buildIcsCalendar('cal', [BASE_EVENT]);
    expect(ics).toContain('DTSTART:20260910T140000Z');
    expect(ics).toContain('DTEND:20260910T150000Z');
  });

  it('emits STATUS:CONFIRMED for a live appointment and STATUS:CANCELLED for a cancelled one', () => {
    const confirmed = buildIcsCalendar('cal', [BASE_EVENT]);
    expect(confirmed).toContain('STATUS:CONFIRMED');

    const cancelled = buildIcsCalendar('cal', [{ ...BASE_EVENT, status: 'cancelled' }]);
    expect(cancelled).toContain('STATUS:CANCELLED');
  });

  it('includes DESCRIPTION/LOCATION only when provided — omits DESCRIPTION entirely for a null (family) input', () => {
    const withNotes = buildIcsCalendar('cal', [BASE_EVENT]);
    expect(withNotes).toContain('DESCRIPTION:Family viewing for Robert Ellison');
    expect(withNotes).toContain('LOCATION:123 Main St\\, Springfield');

    const withoutNotes = buildIcsCalendar('cal', [{ ...BASE_EVENT, description: null, location: null }]);
    expect(withoutNotes).not.toContain('DESCRIPTION:');
    expect(withoutNotes).not.toContain('LOCATION:');
  });

  it('escapes commas, semicolons, backslashes, and newlines in free text per RFC5545', () => {
    const ics = buildIcsCalendar('cal', [{ ...BASE_EVENT, title: 'A, B; C\\D\nnext line' }]);
    expect(ics).toContain('SUMMARY:A\\, B\\; C\\\\D\\nnext line');
  });

  it('emits one independent VEVENT per input event, each with its own UID', () => {
    const second: IcsEventInput = { ...BASE_EVENT, appointmentId: 'appt-2', title: 'Service' };
    const ics = buildIcsCalendar('cal', [BASE_EVENT, second]);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).toContain('UID:beacon-appointment-appt-1@beacon.app');
    expect(ics).toContain('UID:beacon-appointment-appt-2@beacon.app');
  });

  it('folds a line longer than 75 characters, continuing with a leading space', () => {
    const longTitle = 'A'.repeat(120);
    const ics = buildIcsCalendar('cal', [{ ...BASE_EVENT, title: longTitle }]);
    expect(ics).toContain('SUMMARY:' + 'A'.repeat(75 - 'SUMMARY:'.length) + '\r\n ');
  });
});

describe('buildIcsCalendar — optional CREATED/LAST-MODIFIED', () => {
  it('omits CREATED/LAST-MODIFIED when createdAt/updatedAt are absent (the family-DTO case)', () => {
    const withoutTimestamps: IcsEventInput = { ...BASE_EVENT, createdAt: undefined, updatedAt: undefined };
    const ics = buildIcsCalendar('cal', [withoutTimestamps]);
    expect(ics).not.toContain('CREATED:');
    expect(ics).not.toContain('LAST-MODIFIED:');
  });
});

describe('buildSingleEventIcs', () => {
  it('produces exactly one VEVENT', () => {
    const ics = buildSingleEventIcs('cal', BASE_EVENT);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
  });
});
