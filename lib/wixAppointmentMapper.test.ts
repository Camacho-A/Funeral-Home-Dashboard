import { describe, it, expect } from 'vitest';
import { mapWixAppointmentItem, buildWixAppointmentData, applyAppointmentPatchToWixData } from './wixAppointmentMapper';
import type { Appointment } from '../types/appointment';

const APPOINTMENT: Appointment = {
  id: 'appt-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  appointmentType: 'viewing',
  title: 'Viewing for Robert Ellison',
  notes: null,
  locationId: 'location-1',
  status: 'scheduled',
  startAt: '2026-09-01T14:00:00.000Z',
  endAt: '2026-09-01T15:00:00.000Z',
  timezone: 'America/New_York',
  recurrenceDefinitionId: null,
  isRecurrenceException: false,
  ownerStaffProfileId: null,
  createdBy: 'identity-1',
  lastModifiedBy: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  appointmentVersion: 1,
  correlationId: 'corr-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const INTERNAL_APPOINTMENT: Appointment = { ...APPOINTMENT, id: 'appt-2', caseId: null, appointmentType: 'staff.meeting', locationId: null };

describe('wixAppointmentMapper', () => {
  it('round-trips a case-linked appointment', () => {
    expect(mapWixAppointmentItem(buildWixAppointmentData(APPOINTMENT))).toEqual(APPOINTMENT);
  });

  it('round-trips a pure internal appointment with no case/location', () => {
    expect(mapWixAppointmentItem(buildWixAppointmentData(INTERNAL_APPOINTMENT))).toEqual(INTERNAL_APPOINTMENT);
  });

  it('returns null for undefined', () => {
    expect(mapWixAppointmentItem(undefined)).toBeNull();
  });

  it('returns null for an invalid status', () => {
    expect(mapWixAppointmentItem({ ...buildWixAppointmentData(APPOINTMENT), status: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixAppointmentItem({ ...buildWixAppointmentData(APPOINTMENT), isRecurrenceException: 'false' })).toBeNull();
    expect(mapWixAppointmentItem({ ...buildWixAppointmentData(APPOINTMENT), appointmentVersion: undefined })).toBeNull();
  });

  it('applyAppointmentPatchToWixData applies only the given patch fields, leaving the rest untouched', () => {
    const wixItem = buildWixAppointmentData(APPOINTMENT);
    const updated = applyAppointmentPatchToWixData(wixItem, { status: 'cancelled', cancelledAt: '2026-08-15T00:00:00.000Z', cancelledBy: 'identity-2', cancelReason: 'Family rescheduled' });
    expect(updated.status).toBe('cancelled');
    expect(updated.cancelledBy).toBe('identity-2');
    expect(updated.title).toBe(wixItem.title);
    expect(updated.startAt).toBe(wixItem.startAt);
  });
});
