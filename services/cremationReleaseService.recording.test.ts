import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import { completedViewingAppointment, releaseReadyViewingCase, usCaseDate } from './__mocks__/gusReleaseFixtures';
import type { Appointment } from '../types/appointment';
import type { Case } from '../types/case';

/**
 * Recording a release for cremation (Gus Phase 5K) — mock mode, fictional
 * data. RELEASE_FOR_CREMATION_AVAILABLE is switched on IN THIS FILE ONLY;
 * the real switch stays off (see the last test). Nothing is sent.
 */
vi.mock('../domain/servicePreparation/releaseForCremation', async () => ({
  ...(await vi.importActual<object>('../domain/servicePreparation/releaseForCremation')),
  RELEASE_FOR_CREMATION_AVAILABLE: true,
}));

const { approveCremationRelease, CremationReleaseError, evaluateCremationReleaseForCaller, performReleaseAction } = await import('./cremationReleaseService');
const { changeServicePreparation, ServicePreparationError } = await import('./servicePreparationService');

const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const director = { organizationId: GUS, userId: 'identity-gus-director', role: 'funeralDirector' };
const admin = { organizationId: GUS, userId: 'identity-gus-admin', role: 'administrator' };
const NOW = new Date().toISOString();
const originals = caseFixtures.map((c) => c);
const index = () => caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS);
const stored = () => caseFixtures[index()];
const viewing = completedViewingAppointment(GUS, 'gus-case-010', NOW);
const makeReady = (overrides: Partial<Case> = {}) => {
  caseFixtures[index()] = releaseReadyViewingCase(originals[index()], NOW, overrides);
};

beforeEach(() => {
  appointmentFixtures.length = 0;
  appointmentFixtures.push(structuredClone(viewing));
  activityEventFixtures.length = 0;
  makeReady();
});
afterEach(() => {
  originals.forEach((c, i) => (caseFixtures[i] = c));
});

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CremationReleaseError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('recording a release (switch on in this test only)', () => {
  it('every requirement met: the director releases; the release, its history entry and one Activity event share one id', async () => {
    expect((await evaluateCremationReleaseForCaller(director, 'gus-case-010', 'mock', NOW))!.allPrerequisitesMet).toBe(true);
    const { release } = await approveCremationRelease(director, 'gus-case-010', 'mock', { now: NOW, eventId: 'release-1' });
    expect(release!).toMatchObject({ releasedAt: NOW, releasedBy: 'identity-gus-director', releasedByName: 'Jordan Demo', roleKey: 'funeralDirector', eventId: 'release-1' });
    expect(release!.approval).toMatchObject({ basis: 'funeral_director_role', licenseState: 'FL', serviceAppointmentId: 'appt-viewing' });
    expect(release!.approval!.licenseNumber).toBeTruthy();
    expect(release!.approval!.prerequisites.map((p) => p.key)).toContain('medical_examiner_approval');

    const record = stored().servicePreparation!;
    expect(record.release!.eventId).toBe('release-1');
    const entry = record.history!.at(-1)!;
    expect(entry).toMatchObject({ eventId: 'release-1', target: { kind: 'release', key: 'released' }, previous: null, actorId: 'identity-gus-director' });
    expect(record.history!.slice(0, -1).map((e) => e.eventId)).toEqual(['prep-0', 'prep-1']);
    const events = activityEventFixtures.filter((e) => e.eventType === ACTIVITY_EVENT_TYPES.CASE_RELEASED_FOR_CREMATION);
    expect(events).toHaveLength(1);
    expect(events[0].correlationId).toBe('release-1');
  });

  it('nothing else on the case changes: checklist, stage, crematory record and sending are untouched', async () => {
    const before = stored();
    await approveCremationRelease(director, 'gus-case-010', 'mock', { now: NOW, eventId: 'release-1' });
    const after = stored();
    expect(after.checklistState).toEqual(before.checklistState);
    expect(after.crematory).toEqual(before.crematory);
    expect(after.workflowSnapshot).toEqual(before.workflowSnapshot);
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual([ACTIVITY_EVENT_TYPES.CASE_RELEASED_FOR_CREMATION]);
  });

  it('a second release is refused, and preparation becomes read-only', async () => {
    await approveCremationRelease(director, 'gus-case-010', 'mock', { now: NOW, eventId: 'release-1' });
    expect((await refusal(approveCremationRelease(director, 'gus-case-010', 'mock', { now: NOW, eventId: 'release-2' }))).status).toBe(409);
    expect(stored().servicePreparation!.release!.eventId).toBe('release-1');
    const ctx = { organizationId: GUS, actorIdentityId: 'identity-gus-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c' };
    await expect(
      changeServicePreparation(ctx, 'gus-case-010', { change: { kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' }, basis: { at: null }, actorName: 'Avery Demo' }, 'mock'),
    ).rejects.toBeInstanceOf(ServicePreparationError);
  });

  it('an administrator (no license) may REQUEST release; it waits for a licensed sign-off and releases nothing', async () => {
    const result = await performReleaseAction(admin, 'gus-case-010', 'mock', { action: 'release', now: NOW, eventId: 'req-1' });
    expect(result.status).toBe('awaiting_signoff');
    expect(stored().servicePreparation!.release ?? null).toBeNull();
    expect((await refusal(performReleaseAction(admin, 'gus-case-010', 'mock', { action: 'sign_off', now: NOW }))).status).toBe(403);
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual([ACTIVITY_EVENT_TYPES.CASE_RELEASE_WORKFLOW_UPDATED]);
    const signed = await performReleaseAction(director, 'gus-case-010', 'mock', { action: 'sign_off', now: NOW, eventId: 'sign-1' });
    expect(signed.status).toBe('released');
    expect(stored().servicePreparation!.release!.eventId).toBe('sign-1');
    expect(stored().servicePreparation!.releaseEvents!.map((e) => e.type)).toEqual(['release_requested', 'released']);
  });

  it('a read-only user may do nothing; nothing is written', async () => {
    const before = JSON.stringify(stored());
    expect((await refusal(performReleaseAction({ ...admin, role: 'readOnly' }, 'gus-case-010', 'mock', { action: 'release', now: NOW }))).status).toBe(403);
    expect(JSON.stringify(stored())).toBe(before);
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('each missing requirement refuses on its own: ME approval, permit, 48 hours, completed service, identification', async () => {
    const cases: [string, () => void][] = [
      ['me', () => makeReady({ crematory: { ...stored().crematory, medicalExaminerApproval: null } })],
      ['permit', () => makeReady({ crematory: { ...stored().crematory, permitVerification: null } })],
      ['48h', () => makeReady({ dateOfDeath: usCaseDate(Date.parse(NOW)), timeOfDeath: '00:01' })],
      ['service', () => (appointmentFixtures[0] = { ...viewing, status: 'scheduled' } as Appointment)],
      ['identification', () => makeReady({ servicePreparation: null })],
    ];
    for (const [label, breakIt] of cases) {
      originals.forEach((c, i) => (caseFixtures[i] = c));
      appointmentFixtures[0] = structuredClone(viewing);
      makeReady();
      breakIt();
      const error = await refusal(approveCremationRelease(director, 'gus-case-010', 'mock', { now: NOW }));
      expect(error.status, label).toBe(409);
      expect(stored().servicePreparation?.release ?? null, label).toBeNull();
    }
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('an archived case is refused', async () => {
    makeReady({ isDeleted: true });
    expect((await refusal(approveCremationRelease(director, 'gus-case-010', 'mock', { now: NOW }))).status).toBe(409);
  });
});

describe('holds and reauthorization (switch on in this test only)', () => {
  const manager = { organizationId: GUS, userId: 'identity-gus-manager-fictional', role: 'manager' };
  const release = () => performReleaseAction(director, 'gus-case-010', 'mock', { action: 'release', now: NOW, eventId: 'rel' });

  it('a Manager places a hold with a reason; the original release is kept; the hold says nothing was sent yet', async () => {
    await release();
    const original = structuredClone(stored().servicePreparation!.release);
    expect((await refusal(performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'hold', reason: '', now: NOW }))).status).toBe(400);
    const held = await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'hold', reason: 'Family asked to wait', actorName: 'Morgan Demo', now: NOW, eventId: 'hold' });
    expect(held).toMatchObject({ status: 'on_hold', event: { type: 'hold_placed', reason: 'Family asked to wait', actorName: 'Morgan Demo', roleKey: 'manager', paperworkAlreadyTransmitted: false } });
    expect(stored().servicePreparation!.release).toEqual(original);
  });

  it('a hold after the paperwork went out says the crematory must be contacted', async () => {
    await release();
    const c = stored();
    caseFixtures[index()] = { ...c, crematory: { ...c.crematory, lastSubmission: { submissionId: 's', status: 'submitted', packageDocumentId: 'd', packageVersion: 1 } as never } };
    const held = await performReleaseAction(admin, 'gus-case-010', 'mock', { action: 'hold', reason: 'Family asked to wait', now: NOW });
    expect(held.event.paperworkAlreadyTransmitted).toBe(true);
    expect(stored().servicePreparation!.history!.at(-1)!.description).toMatch(/crematory must be contacted/);
  });

  it('read-only users and other organizations cannot hold', async () => {
    await release();
    expect((await refusal(performReleaseAction({ ...manager, role: 'readOnly' }, 'gus-case-010', 'mock', { action: 'hold', reason: 'x', now: NOW }))).status).toBe(403);
    expect((await refusal(performReleaseAction({ ...manager, organizationId: 'managed-cremations' }, 'gus-case-010', 'mock', { action: 'hold', reason: 'x', now: NOW }))).status).toBe(404);
  });

  it('lifting a hold rechecks the latest requirements: a requirement that lapsed refuses it', async () => {
    await release();
    await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'hold', reason: 'Family asked to wait', now: NOW });
    const c = stored();
    caseFixtures[index()] = { ...c, crematory: { ...c.crematory, medicalExaminerApproval: null } };
    expect((await refusal(performReleaseAction(director, 'gus-case-010', 'mock', { action: 'reauthorize', now: NOW }))).status).toBe(409);
    expect((await refusal(performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'reauthorize', now: NOW }))).status).toBe(409);
  });

  it('a licensed director lifts a hold in one step; a Manager only requests it, and cannot sign off', async () => {
    await release();
    await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'hold', reason: 'Family asked to wait', now: NOW });
    expect((await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'reauthorize', now: NOW })).status).toBe('awaiting_reauthorization');
    expect((await refusal(performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'sign_off', now: NOW }))).status).toBe(403);
    expect((await performReleaseAction(director, 'gus-case-010', 'mock', { action: 'sign_off', now: NOW })).status).toBe('reauthorized');
    await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'hold', reason: 'Second hold', now: NOW });
    expect((await performReleaseAction(director, 'gus-case-010', 'mock', { action: 'reauthorize', now: NOW })).status).toBe('reauthorized');
    expect(stored().servicePreparation!.releaseEvents!.map((e) => e.type)).toEqual(['released', 'hold_placed', 'reauthorization_requested', 'reauthorized', 'hold_placed', 'reauthorized']);
  });

  it('a hold is refused before any release, and a duplicate release is refused', async () => {
    expect((await refusal(performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'hold', reason: 'x', now: NOW }))).status).toBe(409);
    await release();
    expect((await refusal(release())).status).toBe(409);
    expect((await refusal(performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'release', now: NOW }))).status).toBe(409);
  });
});

describe('withdrawing requests, corrections, and editing while on hold (switch on in this test only)', () => {
  const manager = { organizationId: GUS, userId: 'identity-gus-manager-fictional', role: 'manager' };
  const ctx = { organizationId: GUS, actorIdentityId: 'identity-gus-manager-fictional', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'c' };
  const prepChange = (reason?: string) =>
    changeServicePreparation(ctx, 'gus-case-010', { change: { kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' }, basis: { at: stored().servicePreparation?.items['prep.crematory.notified']?.at ?? null }, actorName: 'Morgan Demo', reason }, 'mock');

  it.each([
    ['administrator', admin],
    ['manager', manager],
  ])('an %s withdraws a pending release request; it stays in the history', async (_label, caller) => {
    await performReleaseAction(admin, 'gus-case-010', 'mock', { action: 'release', now: NOW, eventId: 'req-1' });
    const withdrawn = await performReleaseAction(caller, 'gus-case-010', 'mock', { action: 'withdraw', reason: 'Asked too early', now: NOW, eventId: 'wd-1' });
    expect(withdrawn).toMatchObject({ status: 'not_released', event: { type: 'request_withdrawn', withdrawsEventId: 'req-1', reason: 'Asked too early' } });
    expect(stored().servicePreparation!.releaseEvents!.map((e) => e.type)).toEqual(['release_requested', 'request_withdrawn']);
    // Nothing pending now: a second withdrawal is refused.
    expect((await refusal(performReleaseAction(caller, 'gus-case-010', 'mock', { action: 'withdraw', now: NOW }))).status).toBe(409);
  });

  it('a read-only user cannot withdraw or correct', async () => {
    await performReleaseAction(admin, 'gus-case-010', 'mock', { action: 'release', now: NOW });
    expect((await refusal(performReleaseAction({ ...admin, role: 'readOnly' }, 'gus-case-010', 'mock', { action: 'withdraw', now: NOW }))).status).toBe(403);
    expect((await refusal(performReleaseAction({ ...admin, role: 'readOnly' }, 'gus-case-010', 'mock', { action: 'correct', reason: 'x', correctsEventId: 'x', now: NOW }))).status).toBe(403);
  });

  it('a Manager corrects the sign-off in force: appended, release on hold, sending blocked, original untouched; a licensed reauthorization lifts it', async () => {
    await performReleaseAction(director, 'gus-case-010', 'mock', { action: 'release', now: NOW, eventId: 'rel-1' });
    const original = structuredClone(stored().servicePreparation!.release);
    expect((await refusal(performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'correct', correctsEventId: 'rel-1', now: NOW }))).status).toBe(400);
    expect((await refusal(performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'correct', reason: 'x', correctsEventId: 'nope', now: NOW }))).status).toBe(409);
    const corrected = await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'correct', reason: 'Recorded against the wrong appointment', correctsEventId: 'rel-1', now: NOW, eventId: 'cor-1' });
    expect(corrected).toMatchObject({ status: 'on_hold', event: { type: 'release_corrected', correctsEventId: 'rel-1' } });
    expect(corrected.evaluation.released).toBe(false);
    expect(stored().servicePreparation!.release).toEqual(original);
    expect(stored().servicePreparation!.releaseEvents![0].eventId).toBe('rel-1');
    // The same sign-off cannot be corrected twice.
    expect((await refusal(performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'correct', reason: 'again', correctsEventId: 'rel-1', now: NOW }))).status).toBe(409);
    expect((await performReleaseAction(director, 'gus-case-010', 'mock', { action: 'reauthorize', now: NOW })).status).toBe('reauthorized');
  });

  it('on hold, preparation changes need a reason, are audited as made during the hold, and a pending reauthorization request locks them', async () => {
    await performReleaseAction(director, 'gus-case-010', 'mock', { action: 'release', now: NOW });
    await expect(prepChange('x')).rejects.toBeInstanceOf(ServicePreparationError);
    await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'hold', reason: 'Family changed plans', now: NOW });
    await expect(prepChange()).rejects.toMatchObject({ status: 400 });
    activityEventFixtures.length = 0;
    const view = await prepChange('Crematory told about the new date');
    expect(view.record!.history!.at(-1)).toMatchObject({ duringHold: true, reason: 'Crematory told about the new date' });
    const activity = activityEventFixtures.find((e) => e.eventType === ACTIVITY_EVENT_TYPES.SERVICE_PREPARATION_UPDATED)!;
    expect(activity.severity).toBe('warning');
    expect(JSON.parse(activity.metadata as string)).toEqual({ duringReleaseHold: true, reason: 'Crematory told about the new date' });

    await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'reauthorize', now: NOW });
    await expect(prepChange('another')).rejects.toMatchObject({ status: 400 });
    await performReleaseAction(manager, 'gus-case-010', 'mock', { action: 'withdraw', now: NOW });
    await expect(prepChange('after withdrawing')).resolves.toBeTruthy();
    // Still on hold until a licensed reauthorization.
    expect((await evaluateCremationReleaseForCaller(manager, 'gus-case-010', 'mock', NOW))!.status).toBe('on_hold');
  });
});

describe('the real switch', () => {
  it('RELEASE_FOR_CREMATION_AVAILABLE is false in the code', async () => {
    const actual = await vi.importActual<typeof import('../domain/servicePreparation/releaseForCremation')>('../domain/servicePreparation/releaseForCremation');
    expect(actual.RELEASE_FOR_CREMATION_AVAILABLE).toBe(false);
  });
});
