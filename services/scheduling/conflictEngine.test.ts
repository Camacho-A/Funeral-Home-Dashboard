import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkConflicts, ConflictEngineError } from './conflictEngine';
import { create as createResource, setStatus as setResourceStatus, createUnavailability } from '../resourceService';
import { resourceFixtures, resourceUnavailabilityFixtures, appointmentResourceAssignmentFixtures } from '../__mocks__/schedulingFixtures';
import { DEFAULT_ORGANIZATION_ID } from '../__mocks__/organizationIds';
import type { AppointmentResourceAssignment } from '../../types/appointmentResourceAssignment';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `resource-${idCounter}`;
}

beforeEach(() => {
  idCounter = 0;
  resourceFixtures.length = 0;
  resourceUnavailabilityFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
});

afterEach(() => {
  resourceFixtures.length = 0;
  resourceUnavailabilityFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
});

function pushAssignment(overrides: Partial<AppointmentResourceAssignment> = {}) {
  const assignment: AppointmentResourceAssignment = {
    id: `assignment-${Math.random()}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    appointmentId: 'appt-existing',
    resourceId: 'resource-1',
    startAt: '2026-09-01T14:00:00.000Z',
    endAt: '2026-09-01T15:00:00.000Z',
    status: 'scheduled',
    assignmentRole: null,
    assignedAt: '2026-08-01T00:00:00.000Z',
    releasedAt: null,
    createdBy: 'identity-1',
    ...overrides,
  };
  appointmentResourceAssignmentFixtures.push(assignment);
  return assignment;
}

describe('checkConflicts — hard conflicts', () => {
  it('reports an overlapping active assignment for a non-external resource', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    pushAssignment({ resourceId: resource.id });
    const { hardConflicts, softConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2026-09-01T14:30:00.000Z', '2026-09-01T16:00:00.000Z', 'mock');
    expect(hardConflicts).toHaveLength(1);
    expect(hardConflicts[0].reason).toBe('overlapping_assignment');
    expect(softConflicts).toHaveLength(0);
  });

  it('reports no conflict for an adjacent, non-overlapping window', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    pushAssignment({ resourceId: resource.id });
    const { hardConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2026-09-01T16:00:00.000Z', '2026-09-01T17:00:00.000Z', 'mock', { bufferMinutes: 0 });
    expect(hardConflicts).toHaveLength(0);
  });

  it('excludes the appointment being rescheduled from its own conflict check', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    pushAssignment({ resourceId: resource.id, appointmentId: 'appt-being-rescheduled' });
    const { hardConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z', 'mock', {
      excludeAppointmentId: 'appt-being-rescheduled',
      bufferMinutes: 0,
    });
    expect(hardConflicts).toHaveLength(0);
  });

  it('reports an overlapping unavailability window', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    await createUnavailability(DEFAULT_ORGANIZATION_ID, { resourceId: resource.id, startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-05T00:00:00.000Z', reason: 'maintenance', createdBy: 'identity-1', idFactory }, 'mock');
    const { hardConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z', 'mock');
    expect(hardConflicts.some((c) => c.reason === 'overlapping_unavailability')).toBe(true);
  });

  it('blocks booking an out_of_service resource regardless of time', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    await setResourceStatus(DEFAULT_ORGANIZATION_ID, resource.id, 'out_of_service', 'mock');
    const { hardConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2027-01-01T00:00:00.000Z', '2027-01-01T01:00:00.000Z', 'mock');
    expect(hardConflicts).toHaveLength(1);
    expect(hardConflicts[0].reason).toBe('resource_out_of_service');
  });

  it('blocks booking an archived resource regardless of time', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    await setResourceStatus(DEFAULT_ORGANIZATION_ID, resource.id, 'archived', 'mock');
    const { hardConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2027-01-01T00:00:00.000Z', '2027-01-01T01:00:00.000Z', 'mock');
    expect(hardConflicts[0].reason).toBe('resource_archived');
  });

  it('never conflict-checks an external resource', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'cemetery', name: 'Green Hills Cemetery', isExternal: true, idFactory }, 'mock');
    await setResourceStatus(DEFAULT_ORGANIZATION_ID, resource.id, 'out_of_service', 'mock');
    pushAssignment({ resourceId: resource.id });
    const { hardConflicts, softConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z', 'mock');
    expect(hardConflicts).toHaveLength(0);
    expect(softConflicts).toHaveLength(0);
  });

  it('throws for an unknown resourceId', async () => {
    await expect(checkConflicts(DEFAULT_ORGANIZATION_ID, ['no-such-resource'], '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z', 'mock')).rejects.toThrow(ConflictEngineError);
  });
});

describe('checkConflicts — soft conflicts', () => {
  it('warns, but does not block, booking a maintenance-status resource', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    await setResourceStatus(DEFAULT_ORGANIZATION_ID, resource.id, 'maintenance', 'mock');
    const { hardConflicts, softConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z', 'mock');
    expect(hardConflicts).toHaveLength(0);
    expect(softConflicts.some((c) => c.reason === 'resource_maintenance')).toBe(true);
  });

  it('warns, but does not block, a booking that falls inside the buffer window of another booking', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    pushAssignment({ resourceId: resource.id, startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z' });
    // Requested window starts 10 minutes after the existing one ends — inside the default 15-minute buffer, but not overlapping.
    const { hardConflicts, softConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2026-09-01T15:10:00.000Z', '2026-09-01T16:00:00.000Z', 'mock');
    expect(hardConflicts).toHaveLength(0);
    expect(softConflicts.some((c) => c.reason === 'buffer_window')).toBe(true);
  });

  it('does not warn when the gap exceeds the buffer window', async () => {
    const resource = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    pushAssignment({ resourceId: resource.id, startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z' });
    const { softConflicts } = await checkConflicts(DEFAULT_ORGANIZATION_ID, [resource.id], '2026-09-01T16:00:00.000Z', '2026-09-01T17:00:00.000Z', 'mock');
    expect(softConflicts).toHaveLength(0);
  });
});
