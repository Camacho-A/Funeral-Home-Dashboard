import { describe, expect, it } from 'vitest';
import {
  DATE_RECEIVED_NOT_RECORDED_LABEL,
  NOT_YET_RECEIVED_LABEL,
  caseDateToIso,
  dateReceivedLabel,
  dateReceivedOf,
  isoToCaseDate,
} from './cremationDates';

describe('cremation date helpers', () => {
  it('converts between the case format and the date-input format', () => {
    expect(isoToCaseDate('2026-10-09')).toBe('10/09/2026');
    expect(caseDateToIso('10/09/2026')).toBe('2026-10-09');
  });

  it('refuses anything that is not a real date rather than guessing', () => {
    expect(isoToCaseDate('2026-02-30')).toBeNull();
    expect(isoToCaseDate('10/09/2026')).toBeNull();
    expect(caseDateToIso('2026-10-09')).toBe('');
    expect(caseDateToIso(null)).toBe('');
  });

});

/**
 * Date received is only ever the date recorded on the case (2026-10 fix).
 * It used to fall back to the pickup appointment's date for a received
 * case with nothing stored — which, for cases received through the old
 * checklist, was the EXPECTED date and could be in the future (B2026-036
 * showed Friday, October 23, 2026 on October 20).
 */
describe('dateReceivedOf — only the recorded date, never a substitute', () => {
  const format = (iso: string) => `[${iso}]`;

  it('a received case with a valid date received shows that date', () => {
    const value = dateReceivedOf({ cremainsReceivedAt: '10/15/2026' }, true);
    expect(value).toEqual({ kind: 'recorded', date: '2026-10-15' });
    expect(dateReceivedLabel(value, format)).toBe('[2026-10-15]');
  });

  it('a received case with no recorded date says so instead of guessing', () => {
    const value = dateReceivedOf({ cremainsReceivedAt: null }, true);
    expect(value).toEqual({ kind: 'date_not_recorded' });
    expect(dateReceivedLabel(value, format)).toBe('Received (date not recorded)');
    expect(DATE_RECEIVED_NOT_RECORDED_LABEL).toBe('Received (date not recorded)');
  });

  it('has no way to be handed the expected pickup, cremation or release date', () => {
    // The old signature took the appointment date as a fallback. The new
    // one takes only the case's own stored field and whether it arrived.
    expect(dateReceivedOf.length).toBe(2);
    const legacy = { cremainsReceivedAt: null, dateOfCremation: '10/10/2026', expectedPickupDate: '10/23/2026', releasedAt: '10/24/2026' };
    expect(dateReceivedOf(legacy, true)).toEqual({ kind: 'date_not_recorded' });
  });

  it('treats blank, placeholder and malformed stored values as not recorded', () => {
    for (const bad of ['', '   ', '—', '2026-10-15', '13/45/2026x', undefined]) {
      expect(dateReceivedOf({ cremainsReceivedAt: bad as string | undefined }, true), String(bad)).toEqual({ kind: 'date_not_recorded' });
    }
  });

  it('an unreceived case reads "Not yet received"', () => {
    expect(dateReceivedOf({ cremainsReceivedAt: null }, false)).toEqual({ kind: 'not_received' });
    expect(dateReceivedOf(null, false)).toEqual({ kind: 'not_received' });
    expect(dateReceivedLabel({ kind: 'not_received' }, format)).toBe(NOT_YET_RECEIVED_LABEL);
  });

  it('keeps an existing recorded date even before the pickup is marked complete', () => {
    expect(dateReceivedOf({ cremainsReceivedAt: '10/14/2026' }, false)).toEqual({ kind: 'recorded', date: '2026-10-14' });
  });
});
