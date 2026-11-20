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

const { approveCremationRelease, CremationReleaseError, evaluateCremationReleaseForCaller } = await import('./cremationReleaseService');
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
    expect(release).toMatchObject({ releasedAt: NOW, releasedBy: 'identity-gus-director', releasedByName: 'Jordan Demo', roleKey: 'funeralDirector', eventId: 'release-1' });
    expect(release.approval).toMatchObject({ basis: 'funeral_director_role', licenseState: 'FL', serviceAppointmentId: 'appt-viewing' });
    expect(release.approval!.licenseNumber).toBeTruthy();
    expect(release.approval!.prerequisites.map((p) => p.key)).toContain('medical_examiner_approval');

    const record = stored().servicePreparation!;
    expect(record.release!.eventId).toBe('release-1');
    const entry = record.history!.at(-1)!;
    expect(entry).toMatchObject({ eventId: 'release-1', target: { kind: 'release', key: 'release_for_cremation' }, previous: null, actorId: 'identity-gus-director' });
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

  it('an administrator without Funeral Director authorization or license is refused; nothing is written', async () => {
    const before = JSON.stringify(stored());
    expect((await refusal(approveCremationRelease(admin, 'gus-case-010', 'mock', { now: NOW }))).status).toBe(403);
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

describe('the real switch', () => {
  it('RELEASE_FOR_CREMATION_AVAILABLE is false in the code', async () => {
    const actual = await vi.importActual<typeof import('../domain/servicePreparation/releaseForCremation')>('../domain/servicePreparation/releaseForCremation');
    expect(actual.RELEASE_FOR_CREMATION_AVAILABLE).toBe(false);
  });
});
