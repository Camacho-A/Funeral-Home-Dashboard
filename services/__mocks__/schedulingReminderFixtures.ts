import type { AppointmentReminder } from '../../types/appointmentReminder';
import type { SchedulingReminderPolicy } from '../../types/schedulingReminderPolicy';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Mock-mode, in-process fixtures for `appointmentReminders`/
 * `schedulingReminderPolicies` — same convention as
 * `services/__mocks__/schedulingFixtures.ts`: plain arrays, mutated
 * directly by `services/appointmentReminderService.ts`'s mock-mode
 * branch, reset between tests by each test file itself
 * (`fixtures.length = 0`), never by this module.
 */
export const appointmentReminderFixtures: AppointmentReminder[] = [];
export const schedulingReminderPolicyFixtures: SchedulingReminderPolicy[] = [];
