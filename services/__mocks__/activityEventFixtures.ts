import type { ActivityEvent } from '../../types/activityEvent';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). Mock-mode fixtures —
 * same "in-memory array, mutated in place by the service's mock branch"
 * convention as every other `services/__mocks__/*Fixtures.ts` file.
 * Starts empty: unlike RBAC's seeded roster, there is no "day one" activity
 * history to seed for Manor's Cremation.
 */
export const activityEventFixtures: ActivityEvent[] = [];
