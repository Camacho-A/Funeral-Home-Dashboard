import type { Resource } from '../../types/resource';
import type { ResourceUnavailability } from '../../types/resourceUnavailability';
import type { RecurrenceDefinition } from '../../types/recurrenceDefinition';
import type { Appointment } from '../../types/appointment';
import type { AppointmentResourceAssignment } from '../../types/appointmentResourceAssignment';

/**
 * Phase 27 (Scheduling & Resource Management). Mock-mode, in-process
 * fixtures for the five new collections this phase introduces — same
 * convention as `services/__mocks__/documentFixtures.ts`/
 * `services/__mocks__/activityEventFixtures.ts`: plain arrays, mutated
 * directly by each service's mock-mode branch, reset between tests by
 * each test file itself (`fixtures.length = 0`), never by this module.
 */
export const resourceFixtures: Resource[] = [];
export const resourceUnavailabilityFixtures: ResourceUnavailability[] = [];
export const recurrenceDefinitionFixtures: RecurrenceDefinition[] = [];
export const appointmentFixtures: Appointment[] = [];
export const appointmentResourceAssignmentFixtures: AppointmentResourceAssignment[] = [];
