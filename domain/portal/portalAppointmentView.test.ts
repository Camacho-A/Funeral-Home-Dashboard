import { describe, it, expect } from 'vitest';
import { buildPortalAppointmentView } from './portalAppointmentView';
import type { Appointment } from '../../types/appointment';

const APPOINTMENT: Appointment = {
  id: 'appt-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  appointmentType: 'family_meeting',
  title: 'Arrangement Conference',
  notes: 'Sensitive internal planning notes',
  locationId: 'location-1',
  status: 'scheduled',
  startAt: '2026-08-10T15:00:00.000Z',
  endAt: '2026-08-10T16:00:00.000Z',
  timezone: 'America/Los_Angeles',
  recurrenceDefinitionId: null,
  isRecurrenceException: false,
  ownerStaffProfileId: null,
  createdBy: 'identity-1',
  lastModifiedBy: 'identity-2',
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  appointmentVersion: 1,
  correlationId: 'corr-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('buildPortalAppointmentView', () => {
  it('exposes only family-safe fields', () => {
    expect(buildPortalAppointmentView(APPOINTMENT)).toEqual({
      id: 'appt-1',
      appointmentType: 'family_meeting',
      title: 'Arrangement Conference',
      locationId: 'location-1',
      status: 'scheduled',
      startAt: '2026-08-10T15:00:00.000Z',
      endAt: '2026-08-10T16:00:00.000Z',
      timezone: 'America/Los_Angeles',
      cancelledAt: null,
      cancelReason: null,
    });
  });

  it('never includes notes, recurrence internals, or staff-identity fields', () => {
    const view = buildPortalAppointmentView(APPOINTMENT);
    const keys = Object.keys(view);
    for (const forbidden of [
      'notes',
      'recurrenceDefinitionId',
      'isRecurrenceException',
      'createdBy',
      'lastModifiedBy',
      'cancelledBy',
      'appointmentVersion',
      'correlationId',
      'organizationId',
      'caseId',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('keeps cancelledAt/cancelReason so a family member can see why an appointment was cancelled', () => {
    const cancelled = buildPortalAppointmentView({ ...APPOINTMENT, status: 'cancelled', cancelledAt: '2026-08-05T00:00:00.000Z', cancelledBy: 'identity-1', cancelReason: 'Family requested reschedule' });
    expect(cancelled.cancelledAt).toBe('2026-08-05T00:00:00.000Z');
    expect(cancelled.cancelReason).toBe('Family requested reschedule');
    expect(cancelled).not.toHaveProperty('cancelledBy');
  });
});
