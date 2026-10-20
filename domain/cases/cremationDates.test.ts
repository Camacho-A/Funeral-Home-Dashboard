import { describe, expect, it } from 'vitest';
import { caseDateToIso, isoToCaseDate, receivedDateOf } from './cremationDates';

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

  it('prefers the stored date received; falls back to the pickup date only for a case received before it existed', () => {
    expect(receivedDateOf({ cremainsReceivedAt: '10/15/2026' }, true, '2026-10-16')).toBe('2026-10-15');
    expect(receivedDateOf({ cremainsReceivedAt: null }, true, '2026-10-16')).toBe('2026-10-16');
    expect(receivedDateOf({ cremainsReceivedAt: null }, false, '2026-10-16')).toBeNull();
    expect(receivedDateOf(null, false, null)).toBeNull();
  });
});
