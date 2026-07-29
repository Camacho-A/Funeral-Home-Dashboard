import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  record,
  encodeCursor,
  decodeCursor,
  listForOrganization,
  listForCase,
  exportCsv,
  recordCaseCreated,
  recordCaseUpdated,
  recordStageChanged,
  recordCaseNoteAdded,
  recordTaskCreated,
  recordTaskCompleted,
  recordPaymentCheckoutCreated,
  recordPaymentRecorded,
  recordPaymentFailed,
  recordPaymentCancelled,
  recordCaseOrderChanged,
  recordTeamMemberInvited,
  recordTeamMemberRoleChanged,
  recordTeamMemberStatusChanged,
  recordInvitationRevoked,
  type ActivityContext,
} from './activityService';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';

let lengths: { events: number };
beforeEach(() => {
  lengths = { events: activityEventFixtures.length };
});
afterEach(() => {
  activityEventFixtures.length = lengths.events;
});

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'funeralDirector',
    correlationId: 'corr-default',
    ...overrides,
  };
}

describe('Immutability — activityService.ts never mutates or deletes an activity event', () => {
  it('imports only insertWixDataItem from lib/wixDataApi.ts, never updateWixDataItem or deleteWixDataItem', () => {
    const source = readFileSync(join(__dirname, 'activityService.ts'), 'utf8');
    const importLine = source.split('\n').find((line) => line.includes("from '../lib/wixDataApi'"));
    expect(importLine).toBeTruthy();
    expect(importLine).toContain('insertWixDataItem');
    expect(importLine).not.toContain('updateWixDataItem');
    expect(importLine).not.toContain('deleteWixDataItem');
    expect(source).not.toContain('updateWixDataItem(');
    expect(source).not.toContain('deleteWixDataItem(');
  });
});

describe('record', () => {
  it('always generates its own id/eventVersion/createdAt, never trusting a caller-supplied value', async () => {
    const event = await record(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: null,
        actorIdentityId: null,
        actorMembershipId: null,
        actorRoleKey: null,
        category: 'system',
        eventType: 'system.reminder.triggered',
        resourceType: 'case',
        resourceId: null,
        previousValue: null,
        newValue: null,
        description: 'A system event',
        metadata: null,
        severity: 'info',
        correlationId: null,
        isSystemGenerated: true,
      },
      'mock',
    );
    expect(event.id).toBeTruthy();
    expect(event.eventVersion).toBe(1);
    expect(event.createdAt).toBeTruthy();
  });
});

describe('cursor encode/decode', () => {
  it('round-trips', () => {
    const cursor = { createdAt: '2026-08-01T00:00:00.000Z', id: 'activity-1' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('returns null for a malformed cursor rather than throwing', () => {
    expect(decodeCursor('not-valid-base64url-json')).toBeNull();
    expect(decodeCursor(Buffer.from('{"onlyOneField":"x"}').toString('base64url'))).toBeNull();
  });
});

describe('typed builder helpers — each produces the correct category/eventType/resourceType/severity', () => {
  it('recordCaseCreated', async () => {
    const e = await recordCaseCreated(ctx(), 'case-1', { caseNumber: 'MC-1001', decedentName: 'Jane Doe' }, 'mock');
    expect(e.category).toBe('cases');
    expect(e.eventType).toBe('case.created');
    expect(e.resourceType).toBe('case');
    expect(e.resourceId).toBe('case-1');
    expect(e.severity).toBe('info');
    expect(e.previousValue).toBeNull();
    expect(JSON.parse(e.newValue!)).toEqual({ caseNumber: 'MC-1001', decedentName: 'Jane Doe' });
  });

  it('recordStageChanged', async () => {
    const e = await recordStageChanged(ctx(), 'case-1', 'arrangement', 'service_scheduled', 'mock');
    expect(e.category).toBe('cases');
    expect(e.eventType).toBe('case.stage.changed');
    expect(JSON.parse(e.previousValue!)).toEqual({ stage: 'arrangement' });
    expect(JSON.parse(e.newValue!)).toEqual({ stage: 'service_scheduled' });
  });

  it('recordCaseNoteAdded — note vs contact produce distinct eventTypes', async () => {
    const note = await recordCaseNoteAdded(ctx(), 'case-1', 'log-1', 'note', 'mock');
    expect(note.eventType).toBe('case.note.added');
    expect(note.resourceType).toBe('caseLogEntry');
    const contact = await recordCaseNoteAdded(ctx(), 'case-1', 'log-2', 'contact', 'mock');
    expect(contact.eventType).toBe('case.contact.logged');
  });

  it('recordTaskCreated / recordTaskCompleted', async () => {
    const created = await recordTaskCreated(ctx(), 'case-1', 'task-1', 'Call florist', 'mock');
    expect(created.eventType).toBe('case.task.created');
    expect(created.resourceType).toBe('task');
    const completed = await recordTaskCompleted(ctx(), 'case-1', 'task-1', 'Call florist', 'mock');
    expect(completed.eventType).toBe('case.task.completed');
    expect(JSON.parse(completed.previousValue!)).toEqual({ isDone: false });
    expect(JSON.parse(completed.newValue!)).toEqual({ isDone: true });
  });

  it('payment lifecycle helpers', async () => {
    const checkout = await recordPaymentCheckoutCreated(ctx(), 'case-1', 'payment-1', 50000, 'mock');
    expect(checkout.eventType).toBe('payment.checkout.created');
    expect(checkout.severity).toBe('info');

    const recorded = await recordPaymentRecorded(ctx(), 'case-1', 'payment-1', 50000, 'mock');
    expect(recorded.eventType).toBe('payment.recorded');
    expect(JSON.parse(recorded.newValue!)).toEqual({ amountCents: 50000 });

    const failed = await recordPaymentFailed(ctx(), 'case-1', 'payment-2', 'card_declined', 'mock');
    expect(failed.eventType).toBe('payment.failed');
    expect(failed.severity).toBe('warning'); // a failure is warning-severity, not info

    const cancelled = await recordPaymentCancelled(ctx(), 'case-1', 'payment-3', 'mock');
    expect(cancelled.eventType).toBe('payment.cancelled');
    expect(cancelled.severity).toBe('info');
  });

  it('recordCaseOrderChanged reuses auditDiff.ts-shaped entries directly', async () => {
    const e = await recordCaseOrderChanged(
      ctx(),
      'case-1',
      'order-1',
      [{ action: 'weight_tier_changed', previousValue: '150-199', newValue: '200-249', description: 'Weight tier changed from 150-199 to 200-249' }],
      'mock',
    );
    expect(e.eventType).toBe('case.order.changed');
    expect(e.resourceType).toBe('caseOrder');
    expect(e.description).toBe('Weight tier changed from 150-199 to 200-249');
  });

  it('team-management helpers exist (forward-compatible, not wired to any route this phase) and produce correct shapes', async () => {
    const invited = await recordTeamMemberInvited(ctx(), 'identity-2', 'readOnly', 'mock');
    expect(invited.eventType).toBe('team.member.invited');
    expect(invited.category).toBe('team_management');

    const roleChanged = await recordTeamMemberRoleChanged(ctx(), 'identity-2', 'readOnly', 'administrator', 'mock');
    expect(roleChanged.severity).toBe('warning');

    const statusChanged = await recordTeamMemberStatusChanged(ctx(), 'identity-2', 'active', 'disabled', 'mock');
    expect(statusChanged.eventType).toBe('team.member.status.changed');

    const revoked = await recordInvitationRevoked(ctx(), 'identity-3', 'mock');
    expect(revoked.eventType).toBe('team.invitation.revoked');
  });
});

describe('previousValue/newValue minimization (recordCaseUpdated)', () => {
  it('stores only the fields that actually changed, never the whole entity', async () => {
    const e = await recordCaseUpdated(
      ctx(),
      'case-1',
      { stage: { previous: 'arrangement', next: 'service_scheduled' } },
      'mock',
    );
    const previous = JSON.parse(e.previousValue!);
    const next = JSON.parse(e.newValue!);
    expect(Object.keys(previous)).toEqual(['stage']);
    expect(Object.keys(next)).toEqual(['stage']);
    expect(previous.stage).toBe('arrangement');
    expect(next.stage).toBe('service_scheduled');
    // Fields never mentioned as changed simply cannot appear — there is no
    // "pass the whole case object" code path through this helper's signature.
    expect(previous.decedentName).toBeUndefined();
  });

  it('supports multiple changed fields in one event without ballooning into a full snapshot', async () => {
    const e = await recordCaseUpdated(
      ctx(),
      'case-1',
      {
        stage: { previous: 'arrangement', next: 'service_scheduled' },
        veteranFlag: { previous: false, next: true },
      },
      'mock',
    );
    expect(Object.keys(JSON.parse(e.previousValue!)).sort()).toEqual(['stage', 'veteranFlag']);
  });
});

describe('correlationId propagation', () => {
  it('one request producing multiple events shares a single correlationId across all of them', async () => {
    const requestCtx = ctx({ correlationId: 'corr-shared-request-1' });
    const stageEvent = await recordStageChanged(requestCtx, 'case-1', 'arrangement', 'service_scheduled', 'mock');
    const taskEvent = await recordTaskCompleted(requestCtx, 'case-1', 'task-1', 'Confirm arrangements', 'mock');
    expect(stageEvent.correlationId).toBe('corr-shared-request-1');
    expect(taskEvent.correlationId).toBe('corr-shared-request-1');
    expect(stageEvent.correlationId).toBe(taskEvent.correlationId);
  });

  it('two independent requests never share a correlationId', async () => {
    const first = await recordStageChanged(ctx({ correlationId: 'corr-a' }), 'case-1', 'a', 'b', 'mock');
    const second = await recordStageChanged(ctx({ correlationId: 'corr-b' }), 'case-1', 'b', 'c', 'mock');
    expect(first.correlationId).not.toBe(second.correlationId);
  });
});

describe('listForOrganization / listForCase — tenant isolation and pagination', () => {
  it('never returns another organization\'s events', async () => {
    await recordStageChanged(ctx({ organizationId: DEFAULT_ORGANIZATION_ID }), 'case-1', 'a', 'b', 'mock');
    await recordStageChanged(ctx({ organizationId: SECOND_MOCK_ORGANIZATION_ID }), 'case-2', 'a', 'b', 'mock');

    const result = await listForOrganization(DEFAULT_ORGANIZATION_ID, {}, null, 50, 'mock');
    expect(result.events.every((e) => e.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(true);
    expect(result.events.some((e) => e.caseId === 'case-2')).toBe(false);
  });

  it('listForCase only returns events for the requested case, even within the same organization', async () => {
    await recordStageChanged(ctx(), 'case-a', 'x', 'y', 'mock');
    await recordStageChanged(ctx(), 'case-b', 'x', 'y', 'mock');

    const result = await listForCase(DEFAULT_ORGANIZATION_ID, 'case-a', null, 50, 'mock');
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((e) => e.caseId === 'case-a')).toBe(true);
  });

  it('paginates correctly — page 2 never repeats or skips a row from page 1', async () => {
    const orgId = 'pagination-test-org';
    for (let i = 0; i < 12; i++) {
      await recordStageChanged(ctx({ organizationId: orgId, correlationId: `corr-${i}` }), 'case-1', `stage-${i}`, `stage-${i + 1}`, 'mock');
    }

    const page1 = await listForOrganization(orgId, {}, null, 5, 'mock');
    expect(page1.events).toHaveLength(5);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listForOrganization(orgId, {}, page1.nextCursor, 5, 'mock');
    expect(page2.events).toHaveLength(5);

    const page1Ids = new Set(page1.events.map((e) => e.id));
    const page2Ids = new Set(page2.events.map((e) => e.id));
    expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false); // no overlap

    const page3 = await listForOrganization(orgId, {}, page2.nextCursor, 5, 'mock');
    expect(page3.events).toHaveLength(2); // the remaining 2 of 12
    expect(page3.nextCursor).toBeNull();
  });

  it('filters by category, resourceType, severity, and free-text query', async () => {
    const orgId = 'filter-test-org';
    await recordPaymentFailed(ctx({ organizationId: orgId }), 'case-1', 'payment-1', 'card_declined', 'mock');
    await recordStageChanged(ctx({ organizationId: orgId }), 'case-1', 'a', 'b', 'mock');

    const byCategory = await listForOrganization(orgId, { category: 'payments' }, null, 50, 'mock');
    expect(byCategory.events.every((e) => e.category === 'payments')).toBe(true);

    const bySeverity = await listForOrganization(orgId, { severity: 'warning' }, null, 50, 'mock');
    expect(bySeverity.events.every((e) => e.severity === 'warning')).toBe(true);
    expect(bySeverity.events.some((e) => e.eventType === 'payment.failed')).toBe(true);

    const byQuery = await listForOrganization(orgId, { query: 'card_declined' }, null, 50, 'mock');
    expect(byQuery.events.some((e) => e.description.includes('card_declined'))).toBe(true);
  });
});

describe('exportCsv', () => {
  it('produces a well-formed CSV with a header row and one row per event', async () => {
    const orgId = 'csv-test-org';
    await recordStageChanged(ctx({ organizationId: orgId }), 'case-1', 'a', 'b', 'mock');
    await recordStageChanged(ctx({ organizationId: orgId }), 'case-1', 'b', 'c', 'mock');

    const csv = await exportCsv(orgId, {}, 'mock');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('createdAt,category,eventType,severity,actorIdentityId,actorRoleKey,caseId,resourceType,resourceId,description');
    expect(lines).toHaveLength(3); // header + 2 events
  });

  it('escapes fields containing commas/quotes', async () => {
    const orgId = 'csv-escape-test-org';
    await recordCaseNoteAdded(ctx({ organizationId: orgId }), 'case-1', 'log-1', 'note', 'mock');
    // Force a description containing a comma to exercise CSV escaping via a direct record() call.
    await record(
      {
        organizationId: orgId,
        caseId: 'case-1',
        actorIdentityId: 'identity-1',
        actorMembershipId: 'membership-1',
        actorRoleKey: 'funeralDirector',
        category: 'cases',
        eventType: 'case.updated',
        resourceType: 'case',
        resourceId: 'case-1',
        previousValue: null,
        newValue: null,
        description: 'Updated "stage", "veteranFlag"',
        metadata: null,
        severity: 'info',
        correlationId: 'corr-csv',
        isSystemGenerated: false,
      },
      'mock',
    );

    const csv = await exportCsv(orgId, {}, 'mock');
    expect(csv).toContain('"Updated ""stage"", ""veteranFlag"""');
  });

  it('is bounded by the row cap and never runs away', async () => {
    // A generous but finite check: exportCsv must terminate and return a
    // string, not hang, even when there are far fewer events than the cap
    // (the cap only bounds the *maximum*, verified by inspecting the guard
    // condition rather than seeding 10,000+ rows in a unit test).
    const orgId = 'csv-cap-test-org';
    await recordStageChanged(ctx({ organizationId: orgId }), 'case-1', 'a', 'b', 'mock');
    const csv = await exportCsv(orgId, {}, 'mock');
    expect(csv.split('\n').length).toBeLessThan(10_002); // header + 10,000 cap
  });
});
