import type { Notification } from '../../types/notification';
import type { NotificationRecipient } from '../../types/notificationRecipient';
import type { NotificationDelivery } from '../../types/notificationDelivery';
import type { NotificationDeliveryAttempt } from '../../types/notificationDeliveryAttempt';
import type { NotificationPreference } from '../../types/notificationPreference';

/**
 * Phase 28 (Communications & Notifications). Mock-mode, in-process
 * fixtures for the five new collections this phase introduces — same
 * convention as `services/__mocks__/schedulingFixtures.ts`: plain arrays,
 * mutated directly by each service's mock-mode branch, reset between
 * tests by each test file itself (`fixtures.length = 0`), never by this
 * module.
 */
export const notificationFixtures: Notification[] = [];
export const notificationRecipientFixtures: NotificationRecipient[] = [];
export const notificationDeliveryFixtures: NotificationDelivery[] = [];
export const notificationDeliveryAttemptFixtures: NotificationDeliveryAttempt[] = [];
export const notificationPreferenceFixtures: NotificationPreference[] = [];
