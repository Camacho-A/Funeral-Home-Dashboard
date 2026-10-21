import { describe, expect, it } from 'vitest';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import { describeDeadline, evaluateCaseSla, slaNeedsAttention, slaSummaryBucket, type SlaMilestoneEvaluation } from './slaMilestones';
import { normalizeSlaSettings, resolveSlaSettings } from './slaSettings';
import type { Case, ChecklistCompletionRecord } from '../../types/case';
import type { SlaDelayRecord, SlaEventKey, SlaMilestoneKey } from '../../types/sla';

/** New York local time in October 2026 (EDT, UTC-4). */
const ny = (date: string, time = '10:00') => `${date}T${time}:00-04:00`;
const SETTINGS = normalizeSlaSettings({}, true);

// 2026-10-19 Mon, 20 Tue, 21 Wed, 22 Thu, 23 Fri, 26 Mon.
const base = (overrides: Partial<Case> = {}): Case => ({
  ...caseFixtures.find((c) => c.id === '1044')!,
  rawStage: 0,
  checklistState: {},
  checklistCompletions: undefined,
  slaEvents: undefined,
  slaDelays: undefined,
  stageEnteredAt: undefined,
  isDeleted: false,
  isMedicalExaminerCase: false,
  cremainsReceivedAt: null,
  pickupStatus: 'awaiting_pickup',
  pickupReleasedAt: null,
  ...overrides,
});
const event = (at: string) => ({ at, recordedAt: at, recordedBy: 'staff-1', source: 'staff' as const });
const events = (map: Partial<Record<SlaEventKey, string>>) => Object.fromEntries(Object.entries(map).map(([k, at]) => [k, event(at!)]));
const done = (at: string): ChecklistCompletionRecord => ({ done: true, method: 'manual', source: 'staff_confirmation', eventType: 'staff.checklist_toggle', eventId: null, at, actorId: 'staff-1' });
const milestone = (case_: Case, key: SlaMilestoneKey, now: string): SlaMilestoneEvaluation =>
  evaluateCaseSla(case_, SETTINGS, now).milestones.find((m) => m.key === key)!;

describe('EDRS entry — 2 business days from case receipt', () => {
  const received = base({ slaEvents: events({ case_received: ny('2026-10-19'), vital_statistics_received: ny('2026-10-19', '11:00') }) });

  it('counts business days to the deadline', () => {
    expect(milestone(received, 'edrs_entry', ny('2026-10-19', '12:00'))).toMatchObject({ state: 'active', status: 'on_track', deadline: '2026-10-21', businessDaysRemaining: 2 });
    expect(milestone(received, 'edrs_entry', ny('2026-10-20'))).toMatchObject({ status: 'due_soon', businessDaysRemaining: 1 });
    expect(milestone(received, 'edrs_entry', ny('2026-10-21', '16:00'))).toMatchObject({ status: 'due_today', businessDaysRemaining: 0, overdue: false });
    expect(milestone(received, 'edrs_entry', ny('2026-10-21', '17:30'))).toMatchObject({ status: 'overdue', overdue: true });
    expect(milestone(received, 'edrs_entry', ny('2026-10-22'))).toMatchObject({ status: 'overdue', businessDaysRemaining: -1 });
  });

  it('a Friday receipt is due Tuesday; an after-hours Monday receipt counts from Tuesday', () => {
    const friday = base({ slaEvents: events({ case_received: ny('2026-10-23'), vital_statistics_received: ny('2026-10-23') }) });
    expect(milestone(friday, 'edrs_entry', ny('2026-10-23', '11:00')).deadline).toBe('2026-10-27');
    const late = base({ slaEvents: events({ case_received: ny('2026-10-19', '18:15') }) });
    expect(milestone(late, 'edrs_entry', ny('2026-10-19', '18:20')).deadline).toBe('2026-10-22');
  });

  it('without the family paperwork, a missed deadline is the family\'s wait — and the deadline is kept', () => {
    const waiting = base({ slaEvents: events({ case_received: ny('2026-10-19') }) });
    const evaluation = milestone(waiting, 'edrs_entry', ny('2026-10-22'));
    expect(evaluation).toMatchObject({ status: 'waiting_on_others', overdue: true, responsibleParty: 'family', deadline: '2026-10-21' });
    expect(evaluation.note).toMatch(/paperwork/);
    // Before the deadline it is still on staff's clock.
    expect(milestone(waiting, 'edrs_entry', ny('2026-10-19', '12:00'))).toMatchObject({ status: 'on_track', responsibleParty: 'staff' });
  });

  it('once the paperwork is in, says how long the information has been available', () => {
    const late = base({ slaEvents: events({ case_received: ny('2026-10-19'), vital_statistics_received: ny('2026-10-20') }) });
    const evaluation = milestone(late, 'edrs_entry', ny('2026-10-22'));
    expect(evaluation).toMatchObject({ status: 'overdue', responsibleParty: 'staff' });
    expect(evaluation.note).toBe('Family paperwork received; information available to staff for 2 business days.');
  });

  it('completes when EDRS is submitted (checklist with its completion record)', () => {
    const submitted = base({
      rawStage: 3,
      slaEvents: events({ case_received: ny('2026-10-19') }),
      checklistState: { '2:0': true },
      checklistCompletions: { '2:0': done(ny('2026-10-20', '14:00')) },
    });
    expect(milestone(submitted, 'edrs_entry', ny('2026-10-22'))).toMatchObject({ state: 'completed', status: 'completed', completedAt: { date: '2026-10-20' } });
  });

  it('an existing case with no recorded receipt time asks for a start date instead of inventing one', () => {
    expect(milestone(base(), 'edrs_entry', ny('2026-10-22'))).toMatchObject({ state: 'start_date_needed', status: 'start_date_needed', deadline: null });
  });
});

describe('Doctor attestation → same-day Hard Save → approval', () => {
  const atEdrs = (extra: Partial<Case> = {}) =>
    base({
      rawStage: 3,
      slaEvents: events({ case_received: ny('2026-10-12') }),
      checklistState: { '2:0': true },
      checklistCompletions: { '2:0': done(ny('2026-10-13', '09:00')) },
      ...extra,
    });

  it('the doctor has 4 business days from the EDRS submission, as an external party', () => {
    expect(milestone(atEdrs(), 'doctor_attestation', ny('2026-10-14'))).toMatchObject({ state: 'active', deadline: '2026-10-19', responsibleParty: 'doctor', external: true });
  });

  it('a legacy tick with no completion record asks for a start date', () => {
    const legacy = atEdrs({ checklistCompletions: undefined });
    expect(milestone(legacy, 'doctor_attestation', ny('2026-10-14'))).toMatchObject({ state: 'start_date_needed' });
  });

  it('attestation received stops the doctor SLA and starts a same-day Hard Save', () => {
    const attested = atEdrs({ slaEvents: events({ case_received: ny('2026-10-12'), attestation_received: ny('2026-10-20', '11:00') }) });
    expect(milestone(attested, 'doctor_attestation', ny('2026-10-20', '12:00')).state).toBe('completed');
    expect(milestone(attested, 'hard_save', ny('2026-10-20', '12:00'))).toMatchObject({ state: 'active', status: 'due_today', deadline: '2026-10-20' });
    expect(milestone(attested, 'hard_save', ny('2026-10-20', '17:05'))).toMatchObject({ status: 'overdue', overdue: true });
  });

  it('an attestation after the cutoff is due the next business day; a Friday evening one, Monday', () => {
    const evening = atEdrs({ slaEvents: events({ case_received: ny('2026-10-12'), attestation_received: ny('2026-10-20', '17:30') }) });
    expect(milestone(evening, 'hard_save', ny('2026-10-20', '17:45'))).toMatchObject({ deadline: '2026-10-21', status: 'due_soon' });
    const friday = atEdrs({ slaEvents: events({ case_received: ny('2026-10-12'), attestation_received: ny('2026-10-23', '18:00') }) });
    expect(milestone(friday, 'hard_save', ny('2026-10-24')).deadline).toBe('2026-10-26');
  });

  it('a holiday moves the next-business-day deadline past it', () => {
    const settings = normalizeSlaSettings({ holidays: ['2026-10-26'] }, true);
    const friday = atEdrs({ slaEvents: events({ case_received: ny('2026-10-12'), attestation_received: ny('2026-10-23', '18:00') }) });
    expect(evaluateCaseSla(friday, settings, ny('2026-10-24')).milestones.find((m) => m.key === 'hard_save')!.deadline).toBe('2026-10-27');
  });

  it('only the Hard Save itself completes the Hard Save SLA, and starts the 2-day approval', () => {
    const saved = atEdrs({
      slaEvents: events({ case_received: ny('2026-10-12'), attestation_received: ny('2026-10-20', '11:00') }),
      checklistState: { '2:0': true, '2:2': true },
      checklistCompletions: { '2:0': done(ny('2026-10-13', '09:00')), '2:2': done(ny('2026-10-20', '15:00')) },
    });
    expect(milestone(saved, 'hard_save', ny('2026-10-20', '16:00')).state).toBe('completed');
    expect(milestone(saved, 'approval', ny('2026-10-20', '16:00'))).toMatchObject({ state: 'active', deadline: '2026-10-22', responsibleParty: 'state' });
  });

  it('an online doctor\'s attestation does not imply the Hard Save', () => {
    const attested = atEdrs({ slaEvents: events({ case_received: ny('2026-10-12'), attestation_received: ny('2026-10-20', '11:00') }) });
    expect(milestone(attested, 'hard_save', ny('2026-10-20', '12:00')).state).toBe('active');
    expect(milestone(attested, 'approval', ny('2026-10-20', '12:00')).state).toBe('not_started');
  });
});

describe('Delays and exceptions', () => {
  const overdueDoctor = (delays: Record<string, SlaDelayRecord> = {}) =>
    base({
      rawStage: 3,
      slaEvents: events({ case_received: ny('2026-10-05'), edrs_submitted: ny('2026-10-06') }),
      slaDelays: delays,
    });
  const delay = (overrides: Partial<SlaDelayRecord>): SlaDelayRecord => ({
    id: 'd1',
    milestone: 'doctor_attestation',
    reason: 'waiting_on_doctor',
    responsibleParty: 'doctor',
    notes: null,
    expectedResolutionDate: null,
    recordedAt: ny('2026-10-15'),
    recordedBy: 'staff-1',
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    ...overrides,
  });

  it('a recorded delay shows who is waited on, without clearing the overdue fact or moving the deadline', () => {
    const before = milestone(overdueDoctor(), 'doctor_attestation', ny('2026-10-20'));
    const after = milestone(overdueDoctor({ d1: delay({}) }), 'doctor_attestation', ny('2026-10-20'));
    expect(before).toMatchObject({ status: 'overdue', overdue: true });
    expect(after).toMatchObject({ status: 'waiting_on_others', overdue: true, deadline: before.deadline, responsibleParty: 'doctor' });
    expect(after.delay?.id).toBe('d1');
  });

  it('a family vacation is an acknowledged exception; a resolved delay no longer applies', () => {
    const pickup = base({ rawStage: 7, cremainsReceivedAt: '10/12/2026', slaDelays: { v: delay({ id: 'v', milestone: 'family_pickup', reason: 'family_vacation', responsibleParty: 'family' }) } });
    expect(milestone(pickup, 'family_pickup', ny('2026-10-26'))).toMatchObject({ status: 'exception_acknowledged', overdue: true, advisory: true });
    const resolved = base({ rawStage: 7, cremainsReceivedAt: '10/12/2026', slaDelays: { v: delay({ id: 'v', milestone: 'family_pickup', reason: 'family_vacation', resolvedAt: ny('2026-10-20'), resolution: 'resolved' }) } });
    expect(milestone(resolved, 'family_pickup', ny('2026-10-26')).status).toBe('overdue');
  });
});

describe('Crematory turnaround and family pickup', () => {
  const sent = (extra: Partial<Case> = {}) =>
    base({
      rawStage: 5,
      checklistState: { '3:0': true, '3:1': true },
      checklistCompletions: { '3:0': done(ny('2026-10-13')), '3:1': done(ny('2026-10-13')) },
      ...extra,
    });

  it('sent to the crematory with no receipt date recorded → Start Date Needed', () => {
    expect(milestone(sent(), 'crematory_turnaround', ny('2026-10-20'))).toMatchObject({ state: 'start_date_needed', deadline: null });
  });

  it('5 business days from the crematory\'s receipt; a fixed weekly schedule moves it to the next return day', () => {
    const received = sent({ slaEvents: events({ crematory_received: ny('2026-10-14') }) });
    expect(milestone(received, 'crematory_turnaround', ny('2026-10-15')).deadline).toBe('2026-10-21');
    const tueFri = normalizeSlaSettings({ crematoryReturnWeekdays: [2, 5] }, true);
    expect(evaluateCaseSla(received, tueFri, ny('2026-10-15')).milestones.find((m) => m.key === 'crematory_turnaround')!.deadline).toBe('2026-10-23');
  });

  it('a date of cremation is not cremains ready; Date Received is', () => {
    const cremated = sent({ slaEvents: events({ crematory_received: ny('2026-10-14') }), dateOfCremation: '10/16/2026' });
    expect(milestone(cremated, 'crematory_turnaround', ny('2026-10-19')).state).toBe('active');
    const back = sent({ slaEvents: events({ crematory_received: ny('2026-10-14') }), cremainsReceivedAt: '10/19/2026' });
    expect(milestone(back, 'crematory_turnaround', ny('2026-10-20')).state).toBe('completed');
    expect(milestone(back, 'family_pickup', ny('2026-10-20'))).toMatchObject({ state: 'active', advisory: true, deadline: '2026-10-26', responsibleParty: 'family' });
  });

  it('only the authorized release completes family pickup', () => {
    const released = sent({ cremainsReceivedAt: '10/12/2026', pickupStatus: 'released', pickupReleasedAt: '10/16/2026' });
    expect(milestone(released, 'family_pickup', ny('2026-10-20'))).toMatchObject({ state: 'completed', completedAt: { date: '2026-10-16' } });
  });
});

describe('Whole-case behaviour', () => {
  it('a case past EDRS with no records shows the earlier milestones completed and asks for the approval start', () => {
    const historical = base({ rawStage: 4 });
    const evaluation = evaluateCaseSla(historical, SETTINGS, ny('2026-10-20'));
    expect(evaluation.milestones.slice(0, 3).map((m) => m.state)).toEqual(['completed', 'completed', 'completed']);
    expect(evaluation.current).toMatchObject({ key: 'approval', state: 'start_date_needed' });
  });

  it('a Medical Examiner case skips EDRS, doctor and Hard Save', () => {
    const me = base({ isMedicalExaminerCase: true, slaEvents: events({ case_received: ny('2026-10-19') }) });
    expect(evaluateCaseSla(me, SETTINGS, ny('2026-10-20')).milestones.slice(0, 3).map((m) => m.state)).toEqual(['not_applicable', 'not_applicable', 'not_applicable']);
  });

  it('archived cases and organizations without SLA tracking have no SLA', () => {
    expect(evaluateCaseSla(base({ isDeleted: true }), SETTINGS, ny('2026-10-20'))).toMatchObject({ enabled: false, current: null });
    expect(evaluateCaseSla(base(), normalizeSlaSettings({}, false), ny('2026-10-20')).enabled).toBe(false);
    expect(resolveSlaSettings({ id: 'gus-camacho-jr' }).enabled).toBe(false);
    expect(resolveSlaSettings({ id: 'managed-cremations' }).enabled).toBe(true);
  });

  it('a completed case (released) has no current SLA', () => {
    const complete = base({ rawStage: 7, cremainsReceivedAt: '10/12/2026', pickupStatus: 'released', pickupReleasedAt: '10/16/2026' });
    const evaluation = evaluateCaseSla(complete, SETTINGS, ny('2026-10-20'));
    expect(evaluation.current).toBeNull();
    expect(evaluation.milestones.every((m) => m.state === 'completed')).toBe(true);
  });

  it('business days in stage come from the recorded stage entry, or are unknown', () => {
    expect(evaluateCaseSla(base({ stageEnteredAt: ny('2026-10-16') }), SETTINGS, ny('2026-10-20')).businessDaysInStage).toBe(2);
    expect(evaluateCaseSla(base(), SETTINGS, ny('2026-10-20')).businessDaysInStage).toBeNull();
  });

  it('describes deadlines and decides Needs Attention from one evaluation', () => {
    const received = base({ slaEvents: events({ case_received: ny('2026-10-19'), vital_statistics_received: ny('2026-10-19') }) });
    const current = (now: string) => evaluateCaseSla(received, SETTINGS, now).current;
    expect(describeDeadline(current(ny('2026-10-19', '12:00'))!)).toBe('Due in 2 business days');
    expect(describeDeadline(current(ny('2026-10-21'))!)).toBe('Due today');
    expect(describeDeadline(current(ny('2026-10-23'))!)).toBe('2 business days overdue');
    expect(slaNeedsAttention(current(ny('2026-10-19', '12:00')))).toBe(false);
    expect(slaNeedsAttention(current(ny('2026-10-20')))).toBe(true);
    expect(slaSummaryBucket(current(ny('2026-10-19', '12:00')))).toBe('on_track');
    expect(slaSummaryBucket(current(ny('2026-10-23')))).toBe('overdue');
    // A missing start date is counted, not pushed into Needs Attention.
    const unknown = evaluateCaseSla(base(), SETTINGS, ny('2026-10-20')).current;
    expect(slaSummaryBucket(unknown)).toBe('start_date_needed');
    expect(slaNeedsAttention(unknown)).toBe(false);
  });
});
