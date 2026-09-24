import { describe, expect, it } from 'vitest';
import { normalizeAppointmentTextFields, normalizeAppointmentCancelReason } from './textNormalization';

describe('normalizeAppointmentTextFields', () => {
  it('uppercases title and notes', () => {
    expect(normalizeAppointmentTextFields({ title: 'family viewing', notes: 'chapel a, 2pm start' })).toEqual({
      title: 'FAMILY VIEWING',
      notes: 'CHAPEL A, 2PM START',
    });
  });

  it('passes null notes through unchanged', () => {
    expect(normalizeAppointmentTextFields({ title: 'service', notes: null })).toEqual({ title: 'SERVICE', notes: null });
  });

  it('is idempotent for already-uppercase values', () => {
    expect(normalizeAppointmentTextFields({ title: 'SERVICE', notes: 'ALREADY CAPS' })).toEqual({ title: 'SERVICE', notes: 'ALREADY CAPS' });
  });

  it('does not mutate the input (pure)', () => {
    const input = { title: 'service', notes: 'note' };
    normalizeAppointmentTextFields(input);
    expect(input.title).toBe('service');
  });
});

describe('normalizeAppointmentCancelReason', () => {
  it('uppercases a cancel reason', () => {
    expect(normalizeAppointmentCancelReason('family rescheduled')).toBe('FAMILY RESCHEDULED');
  });

  it('passes null through unchanged', () => {
    expect(normalizeAppointmentCancelReason(null)).toBeNull();
  });
});
