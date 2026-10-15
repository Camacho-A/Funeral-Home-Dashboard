import type { Resource } from '../../types/resource';
import type { ResourceUnavailability } from '../../types/resourceUnavailability';
import type { RecurrenceDefinition } from '../../types/recurrenceDefinition';
import type { Appointment } from '../../types/appointment';
import type { AppointmentResourceAssignment } from '../../types/appointmentResourceAssignment';
import { mockCollection } from './mockStore';

/**
 * Phase 27 (Scheduling & Resource Management). Mock-mode, in-process
 * fixtures for the five new collections this phase introduces — same
 * convention as `services/__mocks__/documentFixtures.ts`/
 * `services/__mocks__/activityEventFixtures.ts`: plain arrays, mutated
 * directly by each service's mock-mode branch, reset between tests by
 * each test file itself (`fixtures.length = 0`), never by this module.
 */
export const resourceFixtures: Resource[] = mockCollection('resourceFixtures', (): Resource[] => []);
export const resourceUnavailabilityFixtures: ResourceUnavailability[] = mockCollection('resourceUnavailabilityFixtures', (): ResourceUnavailability[] => []);
export const recurrenceDefinitionFixtures: RecurrenceDefinition[] = mockCollection('recurrenceDefinitionFixtures', (): RecurrenceDefinition[] => []);
export const appointmentFixtures: Appointment[] = mockCollection('appointmentFixtures', (): Appointment[] => []);
export const appointmentResourceAssignmentFixtures: AppointmentResourceAssignment[] = mockCollection('appointmentResourceAssignmentFixtures', (): AppointmentResourceAssignment[] => []);
