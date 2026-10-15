import type { CalendarConnection } from '../../types/calendarConnection';
import type { CalendarEventLink } from '../../types/calendarEventLink';
import type { CalendarFeedToken } from '../../types/calendarFeedToken';
import { mockCollection } from './mockStore';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Mock-mode, in-process fixtures for the three calendar-
 * integration collections — same convention as
 * `services/__mocks__/schedulingFixtures.ts`: plain arrays, mutated
 * directly by each owning service's mock-mode branch, reset between
 * tests by each test file itself, never by this module.
 */
export const calendarConnectionFixtures: CalendarConnection[] = mockCollection('calendarConnectionFixtures', (): CalendarConnection[] => []);
export const calendarEventLinkFixtures: CalendarEventLink[] = mockCollection('calendarEventLinkFixtures', (): CalendarEventLink[] => []);
export const calendarFeedTokenFixtures: CalendarFeedToken[] = mockCollection('calendarFeedTokenFixtures', (): CalendarFeedToken[] => []);
