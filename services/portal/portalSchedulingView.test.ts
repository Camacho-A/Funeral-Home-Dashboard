import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { appointmentFixtures } from '../__mocks__/schedulingFixtures';
import { DEFAULT_ORGANIZATION_ID } from '../__mocks__/organizationIds';
import type { Appointment } from '../../types/appointment';

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-portal-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-portal-1',
    appointmentType: 'family_meeting',
    title: 'Arrangement Conference',
    notes: 'Internal notes',
    locationId: 'location-1',
    status: 'scheduled',
    startAt: '2026-08-10T15:00:00.000Z',
    endAt: '2026-08-10T16:00:00.000Z',
    timezone: 'America/Los_Angeles',
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
    ...overrides,
  };
}

let originalLength: number;
beforeEach(() => {
  originalLength = appointmentFixtures.length;
});
afterEach(() => {
  appointmentFixtures.length = originalLength;
});

describe('portalSchedulingView', () => {
  it('listFamilyAppointments maps every appointment for the case through the allowlisting DTO', async () => {
    appointmentFixtures.push(makeAppointment());

    const { listFamilyAppointments } = await import('./portalSchedulingView');
    const list = await listFamilyAppointments(DEFAULT_ORGANIZATION_ID, 'case-portal-1', 'mock');

    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Arrangement Conference');
    expect(list[0]).not.toHaveProperty('notes');
    expect(list[0]).not.toHaveProperty('createdBy');
  });

  it('never returns another case\'s appointments', async () => {
    appointmentFixtures.push(makeAppointment({ id: 'appt-other', caseId: 'case-other' }));

    const { listFamilyAppointments } = await import('./portalSchedulingView');
    const list = await listFamilyAppointments(DEFAULT_ORGANIZATION_ID, 'case-portal-1', 'mock');
    expect(list).toHaveLength(0);
  });
});
