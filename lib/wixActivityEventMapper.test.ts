import { describe, it, expect } from 'vitest';
import { mapWixActivityEventItem, buildWixActivityEventData } from './wixActivityEventMapper';
import type { ActivityEvent } from '../types/activityEvent';

const EVENT: ActivityEvent = {
  id: 'activity-1',
  eventVersion: 1,
  organizationId: 'org-1',
  caseId: 'case-1',
  actorIdentityId: 'identity-1',
  actorMembershipId: 'membership-1',
  actorRoleKey: 'funeralDirector',
  category: 'cases',
  eventType: 'case.updated',
  resourceType: 'case',
  resourceId: 'case-1',
  previousValue: '{"stage":"arrangement"}',
  newValue: '{"stage":"service_scheduled"}',
  description: 'Case stage changed to Service Scheduled',
  metadata: '{"requestId":"req-1"}',
  severity: 'info',
  correlationId: 'corr-1',
  isSystemGenerated: false,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const SYSTEM_EVENT: ActivityEvent = {
  ...EVENT,
  id: 'activity-2',
  actorIdentityId: null,
  actorMembershipId: null,
  actorRoleKey: null,
  caseId: null,
  resourceId: null,
  previousValue: null,
  newValue: null,
  metadata: null,
  correlationId: null,
  isSystemGenerated: true,
  severity: 'warning',
};

describe('wixActivityEventMapper', () => {
  it('round-trips a full user-generated event', () => {
    expect(mapWixActivityEventItem(buildWixActivityEventData(EVENT))).toEqual(EVENT);
  });

  it('round-trips a system-generated event with every optional field null', () => {
    expect(mapWixActivityEventItem(buildWixActivityEventData(SYSTEM_EVENT))).toEqual(SYSTEM_EVENT);
  });

  it('returns null for undefined', () => {
    expect(mapWixActivityEventItem(undefined)).toBeNull();
  });

  it('returns null for an invalid category', () => {
    expect(mapWixActivityEventItem({ ...buildWixActivityEventData(EVENT), category: 'bogus' })).toBeNull();
  });

  it('returns null for an invalid severity', () => {
    expect(mapWixActivityEventItem({ ...buildWixActivityEventData(EVENT), severity: 'catastrophic' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixActivityEventItem({ ...buildWixActivityEventData(EVENT), eventVersion: '1' })).toBeNull();
    expect(mapWixActivityEventItem({ ...buildWixActivityEventData(EVENT), isSystemGenerated: 'false' })).toBeNull();
    expect(mapWixActivityEventItem({ ...buildWixActivityEventData(EVENT), description: undefined })).toBeNull();
  });
});
