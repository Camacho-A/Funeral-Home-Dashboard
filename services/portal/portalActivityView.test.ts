import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { record } from '../activityService';
import { activityEventFixtures } from '../__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from '../__mocks__/organizationIds';

function baseEvent(overrides: Partial<Parameters<typeof record>[0]> = {}): Parameters<typeof record>[0] {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-activity-view-test',
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'funeralDirector',
    category: 'documents',
    eventType: 'document.generated',
    resourceType: 'caseDocument',
    resourceId: 'doc-1',
    previousValue: null,
    newValue: null,
    description: 'A document event',
    metadata: null,
    severity: 'info',
    correlationId: 'corr-1',
    isSystemGenerated: false,
    ...overrides,
  };
}

let originalLength: number;
beforeEach(() => {
  originalLength = activityEventFixtures.length;
});
afterEach(() => {
  activityEventFixtures.length = originalLength;
});

describe('portalActivityView', () => {
  it('listFamilyActivity returns only allowlisted event types, filtering out internal ones', async () => {
    await record(baseEvent({ eventType: 'document.generated', category: 'documents', description: 'Document generated' }), 'mock');
    await record(baseEvent({ eventType: 'case.note.added', category: 'cases', description: 'Note added', resourceType: 'caseLogEntry' }), 'mock');
    await record(baseEvent({ eventType: 'payment.recorded', category: 'payments', description: 'Payment recorded', resourceType: 'payment' }), 'mock');

    const { listFamilyActivity } = await import('./portalActivityView');
    const result = await listFamilyActivity(DEFAULT_ORGANIZATION_ID, 'case-activity-view-test', null, 20, 'mock');

    expect(result.events.map((e) => e.eventType).sort()).toEqual(['document.generated', 'payment.recorded'].sort());
    expect(result.events.every((e) => !('actorIdentityId' in e))).toBe(true);
  });

  it('never returns events from another case', async () => {
    await record(baseEvent({ caseId: 'case-other', eventType: 'document.generated' }), 'mock');

    const { listFamilyActivity } = await import('./portalActivityView');
    const result = await listFamilyActivity(DEFAULT_ORGANIZATION_ID, 'case-activity-view-test', null, 20, 'mock');
    expect(result.events).toHaveLength(0);
  });
});
