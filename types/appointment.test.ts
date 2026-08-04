import { describe, expect, it } from 'vitest';
import { isTerminalAppointmentStatus, type AppointmentStatus } from './appointment';

describe('isTerminalAppointmentStatus', () => {
  it('treats completed/cancelled/no_show as terminal', () => {
    expect(isTerminalAppointmentStatus('completed')).toBe(true);
    expect(isTerminalAppointmentStatus('cancelled')).toBe(true);
    expect(isTerminalAppointmentStatus('no_show')).toBe(true);
  });

  it('treats draft/scheduled/confirmed/in_progress as non-terminal', () => {
    const nonTerminal: AppointmentStatus[] = ['draft', 'scheduled', 'confirmed', 'in_progress'];
    for (const status of nonTerminal) {
      expect(isTerminalAppointmentStatus(status)).toBe(false);
    }
  });
});
