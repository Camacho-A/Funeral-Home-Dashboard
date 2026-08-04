import { describe, it, expect } from 'vitest';
import { mapWixAppointmentResourceAssignmentItem, buildWixAppointmentResourceAssignmentData, applyAppointmentResourceAssignmentUpdateToWixData } from './wixAppointmentResourceAssignmentMapper';
import type { AppointmentResourceAssignment } from '../types/appointmentResourceAssignment';

const ASSIGNMENT: AppointmentResourceAssignment = {
  id: 'assignment-1',
  organizationId: 'org-1',
  appointmentId: 'appt-1',
  resourceId: 'resource-1',
  startAt: '2026-09-01T14:00:00.000Z',
  endAt: '2026-09-01T15:00:00.000Z',
  status: 'scheduled',
  assignmentRole: 'primary director',
  assignedAt: '2026-08-01T00:00:00.000Z',
  releasedAt: null,
  createdBy: 'identity-1',
};

describe('wixAppointmentResourceAssignmentMapper', () => {
  it('round-trips an active assignment', () => {
    expect(mapWixAppointmentResourceAssignmentItem(buildWixAppointmentResourceAssignmentData(ASSIGNMENT))).toEqual(ASSIGNMENT);
  });

  it('round-trips a released assignment', () => {
    const released = { ...ASSIGNMENT, releasedAt: '2026-09-01T16:00:00.000Z' };
    expect(mapWixAppointmentResourceAssignmentItem(buildWixAppointmentResourceAssignmentData(released))).toEqual(released);
  });

  it('returns null for undefined', () => {
    expect(mapWixAppointmentResourceAssignmentItem(undefined)).toBeNull();
  });

  it('returns null for an invalid status', () => {
    expect(mapWixAppointmentResourceAssignmentItem({ ...buildWixAppointmentResourceAssignmentData(ASSIGNMENT), status: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixAppointmentResourceAssignmentItem({ ...buildWixAppointmentResourceAssignmentData(ASSIGNMENT), startAt: undefined })).toBeNull();
  });

  it('applyAppointmentResourceAssignmentUpdateToWixData changes only the patched fields', () => {
    const wixItem = buildWixAppointmentResourceAssignmentData(ASSIGNMENT);
    const updated = applyAppointmentResourceAssignmentUpdateToWixData(wixItem, { releasedAt: '2026-09-01T16:00:00.000Z' });
    expect(updated.releasedAt).toBe('2026-09-01T16:00:00.000Z');
    expect(updated.startAt).toBe(wixItem.startAt);
    expect(updated.resourceId).toBe(wixItem.resourceId);
  });
});
