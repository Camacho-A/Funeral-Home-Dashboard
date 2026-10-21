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
    // Approval was never recorded: shown as such, never counted as met.
    expect(evaluation.milestones.map((m) => m.state)).toEqual(['completed', 'completed', 'completed', 'not_recorded', 'completed', 'completed']);
    expect(evaluation.milestones.find((m) => m.key === 'approval')!.status).toBeNull();
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

describe('State approval is satisfied only by a recorded approval (final review, 2026-10)', () => {
  const saved = (extra: Partial<Case> = {}) =>
    base({
      rawStage: 4,
      checklistState: { '2:2': true },
      checklistCompletions: { '2:2': done(ny('2026-10-19', '15:00')) },
      ...extra,
    });

  it('a permit sent does not complete approval — it stays the current, measurable milestone', () => {
    const permit = saved({
      checklistState: { '2:2': true, '3:0': true },
      checklistCompletions: { '2:2': done(ny('2026-10-19', '15:00')), '3:0': done(ny('2026-10-20', '09:00')) },
    });
    const evaluation = evaluateCaseSla(permit, SETTINGS, ny('2026-10-22', '18:00'));
    expect(evaluation.current).toMatchObject({ key: 'approval', state: 'active', status: 'overdue', deadline: '2026-10-21' });
  });

  it('a recorded approval completes it, and submission, approval and permit-sent keep their own times', () => {
    const approved = saved({
      rawStage: 5,
      checklistState: { '2:2': true, '3:0': true, '3:1': true },
      checklistCompletions: { '2:2': done(ny('2026-10-19', '15:00')), '3:0': done(ny('2026-10-21', '09:00')), '3:1': done(ny('2026-10-21', '09:30')) },
      slaEvents: events({ submitted_for_approval: ny('2026-10-19', '16:00'), approval_received: ny('2026-10-20', '13:00') }),
    });
    const evaluation = evaluateCaseSla(approved, SETTINGS, ny('2026-10-21', '12:00'));
    expect(evaluation.milestones.find((m) => m.key === 'approval')).toMatchObject({ state: 'completed', startedAt: { date: '2026-10-19', minutes: 16 * 60 }, completedAt: { date: '2026-10-20', minutes: 13 * 60 } });
    const time = (key: string) => evaluation.events.find((e) => e.key === key);
    expect(time('hard_saved')).toMatchObject({ time: { date: '2026-10-19', minutes: 15 * 60 }, source: 'checklist' });
    expect(time('submitted_for_approval')).toMatchObject({ time: { date: '2026-10-19', minutes: 16 * 60 }, source: 'recorded' });
    expect(time('approval_received')).toMatchObject({ time: { date: '2026-10-20', minutes: 13 * 60 }, source: 'recorded' });
    expect(time('permit_sent')).toMatchObject({ time: { date: '2026-10-21', minutes: 9 * 60 }, source: 'checklist' });
    expect(time('sent_to_crematory')).toMatchObject({ time: { date: '2026-10-21', minutes: 9 * 60 + 30 }, source: 'checklist' });
  });

  it('without a separate submission time, the Hard Save is the submission', () => {
    expect(evaluateCaseSla(saved(), SETTINGS, ny('2026-10-20')).current).toMatchObject({ key: 'approval', startedAt: { date: '2026-10-19', minutes: 15 * 60 } });
  });
});

describe('Attestation and Hard Save are separate events (final review, 2026-10)', () => {
  it('an attestation alone starts the Hard Save SLA and completes nothing; only the Hard Save completes it', () => {
    const attested = base({ rawStage: 3, slaEvents: events({ attestation_received: ny('2026-10-20', '10:00') }) });
    const now = ny('2026-10-20', '11:00');
    const before = evaluateCaseSla(attested, SETTINGS, now);
    expect(before.milestones.find((m) => m.key === 'doctor_attestation')!.state).toBe('completed');
    expect(before.current).toMatchObject({ key: 'hard_save', state: 'active', status: 'due_today' });
    expect(before.events.find((e) => e.key === 'hard_saved')!.occurred).toBe(false);

    const saved = { ...attested, checklistState: { '2:2': true }, checklistCompletions: { '2:2': done(ny('2026-10-20', '14:00')) } };
    const after = evaluateCaseSla(saved, SETTINGS, now);
    expect(after.milestones.find((m) => m.key === 'hard_save')).toMatchObject({ state: 'completed', completedAt: { date: '2026-10-20', minutes: 14 * 60 } });
  });
});

/**
 * Cremains already back with Manors (2026-10). Production showed B2026-036 —
 * "Ashes picked up" ticked, no Date Received, family not yet collected — as
 * "Current SLA: State approval · Start Date Needed". "Ashes picked up
 * (Tue/Fri)" is Manors collecting the cremains from the crematory, so the
 * crematory's work is done; the open task is the family pickup.
 */
describe('Cremains already back with Manors', () => {
  const NOW = ny('2026-10-21', '11:00');
  // B2026-036's shape: final display stage (rawStage 7 = Completed), every
  // earlier item ticked with no completion records, 5:0 "Ashes picked up"
  // ticked, no Date Received, not released, no SLA events.
  const b2026036 = (extra: Partial<Case> = {}) =>
    base({
      rawStage: 7,
      checklistState: { '2:0': true, '2:2': true, '3:0': true, '3:1': true, '4:0': true, '4:1': true, '5:0': true, '5:5': true },
      ...extra,
    });
  const states = (case_: Case) => Object.fromEntries(evaluateCaseSla(case_, SETTINGS, NOW).milestones.map((m) => [m.key, m.state]));

  it('B2026-036: crematory complete (date not recorded), approval not recorded, current = family pickup awaiting a start date', () => {
    const evaluation = evaluateCaseSla(b2026036(), SETTINGS, NOW);
    expect(states(b2026036())).toEqual({
      edrs_entry: 'completed',
      doctor_attestation: 'completed',
      hard_save: 'completed',
      approval: 'not_recorded',
      crematory_turnaround: 'completed',
      family_pickup: 'start_date_needed',
    });
    expect(evaluation.milestones.find((m) => m.key === 'crematory_turnaround')!.completedAt).toBeNull();
    expect(evaluation.milestones.find((m) => m.key === 'approval')!.status).toBeNull();
    expect(evaluation.current).toMatchObject({ key: 'family_pickup', state: 'start_date_needed', deadline: null, responsibleParty: 'family' });
    expect(evaluation.current!.note).toMatch(/Date Received on the Schedule tab/);
    expect(evaluation.events.find((e) => e.key === 'cremains_received')).toMatchObject({ occurred: true, time: null, source: 'checklist' });
  });

  it('same case at the "Ready for Pickup" stage (B2026-038 shape) reads the same', () => {
    expect(evaluateCaseSla(b2026036({ rawStage: 6 }), SETTINGS, NOW).current).toMatchObject({ key: 'family_pickup', state: 'start_date_needed' });
  });

  it('cremains received with a recorded date: family pickup runs from that date; crematory completes without inventing a ready time', () => {
    const evaluation = evaluateCaseSla(b2026036({ cremainsReceivedAt: '10/16/2026' }), SETTINGS, NOW);
    expect(evaluation.current).toMatchObject({ key: 'family_pickup', state: 'active', deadline: '2026-10-23', startedAt: { date: '2026-10-16', minutes: null } });
    expect(evaluation.milestones.find((m) => m.key === 'crematory_turnaround')).toMatchObject({ state: 'completed', completedAt: null });
  });

  it('the "Ashes picked up" completion record supplies the received time when there is one', () => {
    const recordedTick = b2026036({ checklistCompletions: { '5:0': done(ny('2026-10-16', '10:30')) } });
    expect(evaluateCaseSla(recordedTick, SETTINGS, NOW).current).toMatchObject({ key: 'family_pickup', state: 'active', startedAt: { date: '2026-10-16', minutes: 10 * 60 + 30 } });
  });

  it('cremains ready at the crematory but not yet collected: crematory complete, family pickup not started', () => {
    const ready = base({
      rawStage: 6,
      checklistState: { '3:0': true, '3:1': true },
      slaEvents: events({ crematory_received: ny('2026-10-14'), cremains_ready: ny('2026-10-20', '09:00') }),
    });
    const evaluation = evaluateCaseSla(ready, SETTINGS, NOW);
    expect(evaluation.milestones.find((m) => m.key === 'crematory_turnaround')).toMatchObject({ state: 'completed', completedAt: { date: '2026-10-20' } });
    expect(evaluation.milestones.find((m) => m.key === 'family_pickup')!.state).toBe('not_started');
    expect(evaluation.events.find((e) => e.key === 'cremains_received')!.occurred).toBe(false);
  });

  it('released to the family: no active family pickup, and the release record is the completion', () => {
    const released = b2026036({ pickupStatus: 'released', pickupReleasedAt: '10/19/2026' });
    const evaluation = evaluateCaseSla(released, SETTINGS, NOW);
    expect(evaluation.current).toBeNull();
    expect(evaluation.milestones.find((m) => m.key === 'family_pickup')).toMatchObject({ state: 'completed', completedAt: { date: '2026-10-19' } });
    expect(evaluation.events.find((e) => e.key === 'released')).toMatchObject({ occurred: true, source: 'case' });
  });

  it('a Date of Cremation or an Expected Pickup is never treated as received', () => {
    const notBack = base({ rawStage: 5, checklistState: { '3:0': true, '3:1': true }, dateOfCremation: '10/16/2026' });
    expect(evaluateCaseSla(notBack, SETTINGS, NOW).events.find((e) => e.key === 'cremains_received')!.occurred).toBe(false);
  });

  it('an earlier open milestone with a real deadline stays current; only a missing start time yields to later progress', () => {
    const approvalPending = base({
      rawStage: 5,
      checklistState: { '2:2': true, '3:0': true, '3:1': true },
      checklistCompletions: { '2:2': done(ny('2026-10-19', '15:00')) },
    });
    expect(evaluateCaseSla(approvalPending, SETTINGS, NOW).current).toMatchObject({ key: 'approval', state: 'active' });
  });

  it('archived cases have no SLA at all', () => {
    expect(evaluateCaseSla(b2026036({ isDeleted: true }), SETTINGS, NOW)).toMatchObject({ enabled: false, current: null, milestones: [] });
  });
});
