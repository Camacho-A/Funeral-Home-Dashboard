import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { notificationFixtures, notificationRecipientFixtures } from './__mocks__/notificationFixtures';
import { recordSlaDelay, recordSlaEvent, recordSlaEventAutomatically, resolveSlaDelay, SlaActionError } from './slaService';
import { runSlaAlertSweep, slaAlertFor } from './slaAlertService';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import { NOTIFICATION_TYPES } from '../domain/notifications/notificationTypeRegistry';
import { evaluateCaseSla } from '../domain/sla/slaMilestones';
import { normalizeSlaSettings } from '../domain/sla/slaSettings';
import type { Case } from '../types/case';

/**
 * SLA tracking (2026-10) — the write side and the alert sweep, end to end in
 * mock mode against the Manors and Gus fixture cases (restored after each test).
 */
const MANORS = 'managed-cremations';
const ny = (date: string, time = '10:00') => new Date(`${date}T${time}:00-04:00`).toISOString();
const ctx = { organizationId: MANORS, actorIdentityId: 'staff-7', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c' };

const saved = new Map<number, Case>();
function useCase(id: string, overrides: Partial<Case> = {}): Case {
  const index = caseFixtures.findIndex((c) => c.id === id);
  if (!saved.has(index)) saved.set(index, caseFixtures[index]);
  caseFixtures[index] = { ...caseFixtures[index], checklistState: {}, checklistCompletions: undefined, slaEvents: undefined, slaDelays: undefined, ...overrides };
  return caseFixtures[index];
}
const current = (id: string) => caseFixtures.find((c) => c.id === id)!;
const events = (type: string) => activityEventFixtures.filter((e) => e.eventType === type);
const notifications = (type: string) => notificationFixtures.filter((n) => n.notificationType === type);

beforeEach(() => {
  activityEventFixtures.length = 0;
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
});
afterEach(() => {
  for (const [index, value] of saved) caseFixtures[index] = value;
  saved.clear();
});

describe('recordSlaEvent', () => {
  it('records the time, who recorded it, and an activity event', async () => {
    useCase('1042');
    await recordSlaEvent(ctx, '1042', 'approval_received', ny('2026-10-20'), 'mock', ny('2026-10-20', '11:00'));
    expect(current('1042').slaEvents?.approval_received).toMatchObject({ at: ny('2026-10-20'), recordedBy: 'staff-7', source: 'staff' });
    expect(events(ACTIVITY_EVENT_TYPES.CASE_SLA_EVENT_RECORDED)).toHaveLength(1);
    expect(events(ACTIVITY_EVENT_TYPES.CASE_SLA_EVENT_RECORDED)[0].actorIdentityId).toBe('staff-7');
  });

  it('the same time again changes nothing; a different time is a correction that keeps the previous one in the audit', async () => {
    useCase('1042');
    await recordSlaEvent(ctx, '1042', 'approval_received', ny('2026-10-20'), 'mock', ny('2026-10-21'));
    expect(await recordSlaEvent(ctx, '1042', 'approval_received', ny('2026-10-20'), 'mock', ny('2026-10-21'))).toBeNull();
    await recordSlaEvent(ctx, '1042', 'approval_received', ny('2026-10-19'), 'mock', ny('2026-10-21'));
    const recorded = events(ACTIVITY_EVENT_TYPES.CASE_SLA_EVENT_RECORDED);
    expect(recorded).toHaveLength(2);
    expect(JSON.parse(recorded[1].previousValue!)).toEqual({ approval_received: ny('2026-10-20') });
  });

  it('refuses a future time, an unknown event, an archived case, and an organization without SLA tracking', async () => {
    useCase('1042');
    await expect(recordSlaEvent(ctx, '1042', 'approval_received', ny('2026-10-22'), 'mock', ny('2026-10-20'))).rejects.toMatchObject({ status: 422 });
    await expect(recordSlaEvent(ctx, '1042', 'made_up', ny('2026-10-20'), 'mock')).rejects.toBeInstanceOf(SlaActionError);
    useCase('1042', { isDeleted: true });
    await expect(recordSlaEvent(ctx, '1042', 'approval_received', ny('2026-10-20'), 'mock', ny('2026-10-21'))).rejects.toMatchObject({ status: 409 });
    await expect(recordSlaEvent({ ...ctx, organizationId: 'gus-camacho-jr' }, 'gus-case-001', 'approval_received', ny('2026-10-20'), 'mock')).rejects.toMatchObject({ status: 404 });
  });

  it('a recorded Hard Save completes its checklist item automatically, stops the Hard Save SLA and starts approval', async () => {
    useCase('1042', { rawStage: 3, slaEvents: { attestation_received: { at: ny('2026-10-20', '09:00'), recordedAt: ny('2026-10-20', '09:00'), recordedBy: 's', source: 'staff' } } });
    await recordSlaEvent(ctx, '1042', 'hard_saved', ny('2026-10-20', '15:00'), 'mock', ny('2026-10-20', '15:05'));
    expect(current('1042').checklistState['2:2']).toBe(true);
    expect(current('1042').checklistCompletions?.['2:2']).toMatchObject({ method: 'automatic', source: 'workflow_event', eventType: 'sla.event_recorded', eventId: 'hard_saved' });
    expect(events(ACTIVITY_EVENT_TYPES.CASE_CHECKLIST_COMPLETED_AUTOMATICALLY)).toHaveLength(1);
    const sla = evaluateCaseSla(current('1042'), normalizeSlaSettings({}, true), ny('2026-10-20', '16:00'));
    expect(sla.milestones.find((m) => m.key === 'hard_save')!.state).toBe('completed');
    expect(sla.current).toMatchObject({ key: 'approval', state: 'active', deadline: '2026-10-22' });
  });

  it('a Hard Save the staff member had reopened by hand is recorded, but the checklist decision stands', async () => {
    useCase('1042', {
      rawStage: 3,
      checklistState: { '2:2': false },
      checklistCompletions: { '2:2': { done: false, method: 'manual', source: 'staff_confirmation', eventType: 'staff.checklist_toggle', eventId: null, at: ny('2026-10-19'), actorId: 's' } },
    });
    await recordSlaEvent(ctx, '1042', 'hard_saved', ny('2026-10-20'), 'mock', ny('2026-10-20', '11:00'));
    expect(current('1042').slaEvents?.hard_saved).toBeDefined();
    expect(current('1042').checklistState['2:2']).toBe(false);
  });

  it('an attestation announces the same-day Hard Save once — re-recording it does not notify again', async () => {
    useCase('1042', { rawStage: 3 });
    await recordSlaEvent(ctx, '1042', 'attestation_received', ny('2026-10-20', '11:00'), 'mock', ny('2026-10-20', '11:05'));
    const due = notifications(NOTIFICATION_TYPES.CASE_SLA_HARD_SAVE_DUE.key);
    expect(due.length).toBeGreaterThan(0);
    expect(due[0].body).toMatch(/today, by 5:00 PM/);
    const count = due.length;
    await recordSlaEvent(ctx, '1042', 'attestation_received', ny('2026-10-20', '11:00'), 'mock', ny('2026-10-20', '11:10'));
    expect(notifications(NOTIFICATION_TYPES.CASE_SLA_HARD_SAVE_DUE.key)).toHaveLength(count);
  });
});

describe('recordSlaEventAutomatically', () => {
  it('keeps the first time SOLIS saw it and never overwrites one staff recorded', async () => {
    useCase('1044');
    expect(await recordSlaEventAutomatically(MANORS, '1044', 'vital_statistics_received', ny('2026-10-19'), 'mock')).toBe(true);
    expect(await recordSlaEventAutomatically(MANORS, '1044', 'vital_statistics_received', ny('2026-10-20'), 'mock')).toBe(false);
    expect(current('1044').slaEvents?.vital_statistics_received).toMatchObject({ at: ny('2026-10-19'), source: 'automatic', recordedBy: null });
    expect(events(ACTIVITY_EVENT_TYPES.CASE_SLA_EVENT_RECORDED)[0].isSystemGenerated).toBe(true);
    expect(await recordSlaEventAutomatically('gus-camacho-jr', 'gus-case-001', 'vital_statistics_received', ny('2026-10-19'), 'mock')).toBe(false);
  });
});

describe('delays', () => {
  it('a new delay supersedes the open one, keeping both, and resolving is recorded', async () => {
    useCase('1042', { rawStage: 3 });
    let n = 0;
    const ids = () => `delay-${++n}`;
    await recordSlaDelay(ctx, '1042', { milestone: 'doctor_attestation', reason: 'waiting_on_doctor', notes: 'Called twice' }, 'mock', ny('2026-10-19'), ids);
    await recordSlaDelay(ctx, '1042', { milestone: 'doctor_attestation', reason: 'medical_examiner', expectedResolutionDate: '2026-10-23' }, 'mock', ny('2026-10-20'), ids);
    const delays = current('1042').slaDelays!;
    expect(delays['delay-1']).toMatchObject({ resolution: 'superseded', resolvedBy: 'staff-7', notes: 'Called twice', responsibleParty: 'doctor' });
    expect(delays['delay-2']).toMatchObject({ resolvedAt: null, reason: 'medical_examiner', responsibleParty: 'medical_examiner', expectedResolutionDate: '2026-10-23' });

    await resolveSlaDelay(ctx, '1042', 'delay-2', 'mock', ny('2026-10-21'));
    expect(current('1042').slaDelays!['delay-2']).toMatchObject({ resolution: 'resolved', resolvedAt: ny('2026-10-21') });
    expect(await resolveSlaDelay(ctx, '1042', 'delay-2', 'mock')).toBeNull();
    expect(events(ACTIVITY_EVENT_TYPES.CASE_SLA_DELAY_RECORDED)).toHaveLength(2);
    expect(events(ACTIVITY_EVENT_TYPES.CASE_SLA_DELAY_RESOLVED)).toHaveLength(1);
  });

  it('validates the milestone, reason and date', async () => {
    useCase('1042');
    await expect(recordSlaDelay(ctx, '1042', { milestone: 'nope', reason: 'other' }, 'mock')).rejects.toMatchObject({ status: 400 });
    await expect(recordSlaDelay(ctx, '1042', { milestone: 'approval', reason: 'nope' }, 'mock')).rejects.toMatchObject({ status: 422 });
    await expect(recordSlaDelay(ctx, '1042', { milestone: 'approval', reason: 'other', expectedResolutionDate: '02/30/2026' }, 'mock')).rejects.toMatchObject({ status: 422 });
  });
});

describe('SLA alerts', () => {
  const settings = normalizeSlaSettings({}, true);

  it('decides alerts: staff due/overdue, external past target; never advisory, never with a recorded delay', () => {
    const base = { state: 'active', advisory: false, external: false, delay: null, overdue: false } as const;
    expect(slaAlertFor({ ...base, status: 'due_today' } as never, settings)).toBe('due');
    expect(slaAlertFor({ ...base, status: 'overdue', overdue: true } as never, settings)).toBe('overdue');
    expect(slaAlertFor({ ...base, status: 'waiting_on_others', overdue: true } as never, settings)).toBeNull();
    expect(slaAlertFor({ ...base, external: true, status: 'overdue', overdue: true } as never, settings)).toBe('external_overdue');
    expect(slaAlertFor({ ...base, external: true, status: 'due_today' } as never, settings)).toBeNull();
    expect(slaAlertFor({ ...base, advisory: true, external: true, status: 'overdue', overdue: true } as never, settings)).toBeNull();
    expect(slaAlertFor({ ...base, status: 'overdue', overdue: true, delay: { id: 'd' } } as never, settings)).toBeNull();
    expect(slaAlertFor({ ...base, status: 'overdue', overdue: true } as never, normalizeSlaSettings({ notifications: { overdue: false } }, true))).toBeNull();
  });

  it('the sweep notifies an overdue staff milestone once, however often it runs, and never for Gus', async () => {
    useCase('1044', {
      rawStage: 0,
      isDeleted: false,
      slaEvents: {
        case_received: { at: ny('2026-10-12'), recordedAt: ny('2026-10-12'), recordedBy: null, source: 'automatic' },
        vital_statistics_received: { at: ny('2026-10-12'), recordedAt: ny('2026-10-12'), recordedBy: null, source: 'automatic' },
      },
    });
    await runSlaAlertSweep(ny('2026-10-20'), 'mock');
    const overdue = notifications(NOTIFICATION_TYPES.CASE_SLA_OVERDUE.key).filter((n) => n.entityId === '1044');
    expect(overdue.length).toBeGreaterThan(0);
    expect(overdue[0].body).toMatch(/EDRS entry/);
    await runSlaAlertSweep(ny('2026-10-20', '15:00'), 'mock');
    expect(notifications(NOTIFICATION_TYPES.CASE_SLA_OVERDUE.key).filter((n) => n.entityId === '1044')).toHaveLength(overdue.length);
    expect(notificationFixtures.some((n) => n.organizationId === 'gus-camacho-jr')).toBe(false);
  });

  it('never alerts on an archived case', async () => {
    useCase('1044', {
      isDeleted: true,
      slaEvents: { case_received: { at: ny('2026-10-12'), recordedAt: ny('2026-10-12'), recordedBy: null, source: 'automatic' } },
    });
    await runSlaAlertSweep(ny('2026-10-20'), 'mock');
    expect(notificationFixtures.filter((n) => n.entityId === '1044')).toHaveLength(0);
  });
});
