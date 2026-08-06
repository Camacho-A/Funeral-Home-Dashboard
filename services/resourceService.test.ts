import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { list, get, create, update, setStatus, listUnavailability, createUnavailability, getAvailability, ResourceServiceError } from './resourceService';
import { StaffAssignmentError } from './staffProfileService';
import { resourceFixtures, resourceUnavailabilityFixtures, appointmentResourceAssignmentFixtures } from './__mocks__/schedulingFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { AppointmentResourceAssignment } from '../types/appointmentResourceAssignment';

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

describe('create/get/list', () => {
  it('creates a resource with status active and resourceVersion 1', async () => {
    const resource = await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    expect(resource.status).toBe('active');
    expect(resource.resourceVersion).toBe(1);
    expect(resource.isExternal).toBe(false);
  });

  it('creates a staff resource carrying a linkedMembershipId, without duplicating any identity/role data', async () => {
    const resource = await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'staff', name: 'Jane Director', linkedMembershipId: 'membership-1', idFactory }, 'mock');
    expect(resource.linkedMembershipId).toBe('membership-1');
    // The Resource type itself has no role/email/identity field of any kind to duplicate.
    expect(Object.keys(resource)).not.toContain('role');
    expect(Object.keys(resource)).not.toContain('email');
  });

  it('creates an external resource never subject to conflict checks', async () => {
    const resource = await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'cemetery', name: 'Green Hills Cemetery', isExternal: true, idFactory }, 'mock');
    expect(resource.isExternal).toBe(true);
  });

  describe('Phase 30 (Identity Model Hardening & Staff Assignment Unification): linkedStaffProfileId', () => {
    it('accepts a real, active, in-organization linkedStaffProfileId, coexisting with linkedMembershipId', async () => {
      const resource = await create(
        DEFAULT_ORGANIZATION_ID,
        { resourceType: 'staff', name: 'Dana', linkedMembershipId: 'membership-manors-admin', linkedStaffProfileId: 'staff-dana', idFactory },
        'mock',
      );
      expect(resource.linkedStaffProfileId).toBe('staff-dana');
      expect(resource.linkedMembershipId).toBe('membership-manors-admin');
    });

    it('rejects a nonexistent linkedStaffProfileId — existence + org match, not full assignment-eligibility (no permission check)', async () => {
      await expect(
        create(DEFAULT_ORGANIZATION_ID, { resourceType: 'staff', name: 'Ghost', linkedStaffProfileId: 'staff-does-not-exist', idFactory }, 'mock'),
      ).rejects.toThrow(StaffAssignmentError);
    });

    it('rejects a linkedStaffProfileId from a different organization', async () => {
      await expect(
        create(SECOND_MOCK_ORGANIZATION_ID, { resourceType: 'staff', name: 'Cross-org', linkedStaffProfileId: 'staff-dana', idFactory }, 'mock'),
      ).rejects.toThrow(StaffAssignmentError);
    });

    it('update() validates a newly-linked linkedStaffProfileId the same way create() does', async () => {
      const resource = await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'staff', name: 'Priya', idFactory }, 'mock');
      const updated = await update(DEFAULT_ORGANIZATION_ID, resource.id, { linkedStaffProfileId: 'staff-priya' }, 'mock');
      expect(updated.linkedStaffProfileId).toBe('staff-priya');

      await expect(update(DEFAULT_ORGANIZATION_ID, resource.id, { linkedStaffProfileId: 'staff-does-not-exist' }, 'mock')).rejects.toThrow(StaffAssignmentError);
    });
  });

  it('lists only resources scoped to the requesting organization', async () => {
    await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse 1', idFactory }, 'mock');
    await create(SECOND_MOCK_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse 2', idFactory }, 'mock');
    const results = await list(DEFAULT_ORGANIZATION_ID, {}, 'mock');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Hearse 1');
  });

  it('filters by resourceType/locationId/status', async () => {
    await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Chapel', idFactory }, 'mock');
    const results = await list(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel' }, 'mock');
    expect(results).toHaveLength(1);
    expect(results[0].resourceType).toBe('chapel');
  });

  it('get returns null for a resource in a different organization', async () => {
    const resource = await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    expect(await get(SECOND_MOCK_ORGANIZATION_ID, resource.id, 'mock')).toBeNull();
  });
});

describe('update/setStatus', () => {
  it('updates descriptive fields without touching status', async () => {
    const resource = await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
    const updated = await update(DEFAULT_ORGANIZATION_ID, resource.id, { name: 'East Chapel' }, 'mock');
    expect(updated.name).toBe('East Chapel');
    expect(updated.status).toBe('active');
  });

  it('setStatus is a lifecycle transition, not a boolean flip', async () => {
    const resource = await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    const maintained = await setStatus(DEFAULT_ORGANIZATION_ID, resource.id, 'maintenance', 'mock');
    expect(maintained.status).toBe('maintenance');
    const outOfService = await setStatus(DEFAULT_ORGANIZATION_ID, resource.id, 'out_of_service', 'mock');
    expect(outOfService.status).toBe('out_of_service');
  });

  it('throws for a resource that does not exist in this organization', async () => {
    await expect(update(DEFAULT_ORGANIZATION_ID, 'no-such-resource', { name: 'x' }, 'mock')).rejects.toThrow(ResourceServiceError);
  });
});

describe('listUnavailability/createUnavailability', () => {
  it('creates and lists a maintenance window scoped to one resource', async () => {
    const resource = await create(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    await createUnavailability(DEFAULT_ORGANIZATION_ID, { resourceId: resource.id, startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-05T00:00:00.000Z', reason: 'maintenance', createdBy: 'identity-1', idFactory }, 'mock');
    const windows = await listUnavailability(DEFAULT_ORGANIZATION_ID, resource.id, 'mock');
    expect(windows).toHaveLength(1);
    expect(windows[0].reason).toBe('maintenance');
  });
});

describe('getAvailability', () => {
  function makeAssignment(overrides: Partial<AppointmentResourceAssignment> = {}): AppointmentResourceAssignment {
    return {
      id: `assignment-${Math.random()}`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      appointmentId: 'appt-1',
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
  }

  it('returns an assignment overlapping the requested range', async () => {
    appointmentResourceAssignmentFixtures.push(makeAssignment());
    const { assignments } = await getAvailability(DEFAULT_ORGANIZATION_ID, 'resource-1', '2026-09-01T14:30:00.000Z', '2026-09-01T16:00:00.000Z', 'mock');
    expect(assignments).toHaveLength(1);
  });

  it('excludes an assignment entirely outside the requested range', async () => {
    appointmentResourceAssignmentFixtures.push(makeAssignment());
    const { assignments } = await getAvailability(DEFAULT_ORGANIZATION_ID, 'resource-1', '2026-09-02T00:00:00.000Z', '2026-09-02T01:00:00.000Z', 'mock');
    expect(assignments).toHaveLength(0);
  });

  it('excludes a released assignment', async () => {
    appointmentResourceAssignmentFixtures.push(makeAssignment({ releasedAt: '2026-08-15T00:00:00.000Z' }));
    const { assignments } = await getAvailability(DEFAULT_ORGANIZATION_ID, 'resource-1', '2026-09-01T14:30:00.000Z', '2026-09-01T16:00:00.000Z', 'mock');
    expect(assignments).toHaveLength(0);
  });

  it('includes an overlapping unavailability window', async () => {
    await createUnavailability(
      DEFAULT_ORGANIZATION_ID,
      { resourceId: 'resource-1', startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-05T00:00:00.000Z', reason: 'maintenance', createdBy: 'identity-1', idFactory },
      'mock',
    );
    const { unavailability } = await getAvailability(DEFAULT_ORGANIZATION_ID, 'resource-1', '2026-09-01T14:30:00.000Z', '2026-09-01T16:00:00.000Z', 'mock');
    expect(unavailability).toHaveLength(1);
  });

  it('never crosses tenant boundaries', async () => {
    appointmentResourceAssignmentFixtures.push(makeAssignment({ organizationId: SECOND_MOCK_ORGANIZATION_ID }));
    const { assignments } = await getAvailability(DEFAULT_ORGANIZATION_ID, 'resource-1', '2026-09-01T14:30:00.000Z', '2026-09-01T16:00:00.000Z', 'mock');
    expect(assignments).toHaveLength(0);
  });
});
