import { describe, it, expect } from 'vitest';
import { FAMILY_VISIBLE_EVENT_TYPES, isFamilyVisibleEventType, buildPortalActivityView } from './portalActivityView';
import type { ActivityEvent } from '../../types/activityEvent';

const EVENT: ActivityEvent = {
  id: 'event-1',
  eventVersion: 1,
  organizationId: 'org-1',
  caseId: 'case-1',
  actorIdentityId: 'identity-1',
  actorMembershipId: 'membership-1',
  actorRoleKey: 'funeralDirector',
  category: 'documents',
  eventType: 'document.generated',
  resourceType: 'caseDocument',
  resourceId: 'doc-1',
  previousValue: null,
  newValue: JSON.stringify({ templateId: 'template-1' }),
  description: 'Cremation Authorization generated',
  metadata: null,
  severity: 'info',
  correlationId: 'corr-1',
  isSystemGenerated: false,
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('FAMILY_VISIBLE_EVENT_TYPES / isFamilyVisibleEventType', () => {
  it('includes exactly the named family-relevant event types', () => {
    expect([...FAMILY_VISIBLE_EVENT_TYPES].sort()).toEqual(
      [
        'document.uploaded',
        'document.generated',
        'document.signature.completed',
        'payment.recorded',
        'scheduling.appointment.created',
        'scheduling.appointment.rescheduled',
        'scheduling.appointment.cancelled',
        'scheduling.appointment.completed',
        'portal.message.sent',
      ].sort(),
    );
  });

  it('excludes case notes, task, team-management, and audit event types', () => {
    for (const excluded of ['case.note.added', 'case.task.created', 'team.member.invited', 'audit.exported', 'case.updated']) {
      expect(isFamilyVisibleEventType(excluded)).toBe(false);
    }
  });

  it('excludes the portal-user\'s-own-action event types (login/viewed) from their own timeline', () => {
    expect(isFamilyVisibleEventType('portal.login')).toBe(false);
    expect(isFamilyVisibleEventType('portal.document.viewed')).toBe(false);
    expect(isFamilyVisibleEventType('portal.invited')).toBe(false);
  });
});

describe('buildPortalActivityView', () => {
  it('exposes only family-safe fields', () => {
    expect(buildPortalActivityView(EVENT)).toEqual({
      id: 'event-1',
      eventType: 'document.generated',
      category: 'documents',
      description: 'Cremation Authorization generated',
      severity: 'info',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('never includes actorIdentityId, correlationId, resourceId, or raw previousValue/newValue/metadata', () => {
    const view = buildPortalActivityView(EVENT);
    const keys = Object.keys(view);
    for (const forbidden of ['actorIdentityId', 'actorMembershipId', 'actorRoleKey', 'correlationId', 'resourceId', 'resourceType', 'previousValue', 'newValue', 'metadata', 'organizationId', 'caseId']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
