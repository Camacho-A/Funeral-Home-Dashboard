import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import { approveCremationRelease, CremationReleaseError, evaluateCremationReleaseForCaller } from './cremationReleaseService';
import type { Appointment } from '../types/appointment';

/** Release for cremation on the server (Gus Phase 5F) — mock mode, fictional data. Nothing is ever released. */

const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const director = { organizationId: GUS, userId: 'identity-gus-director', role: 'funeralDirector' };
const admin = { organizationId: GUS, userId: 'identity-gus-admin', role: 'administrator' };
const viewer = { organizationId: GUS, userId: 'identity-gus-viewer', role: 'readOnly' };

const originals = caseFixtures.map((c) => c);
beforeEach(() => {
  appointmentFixtures.length = 0;
  activityEventFixtures.length = 0;
});
afterEach(() => {
  originals.forEach((c, i) => (caseFixtures[i] = c));
});

const completedViewing = (): Appointment =>
  ({
    id: 'appt-viewing',
    organizationId: GUS,
    caseId: 'gus-case-010',
    appointmentType: 'viewing',
    status: 'completed',
    startAt: '2026-12-10T15:00:00.000Z',
    endAt: '2026-12-10T17:00:00.000Z',
    createdAt: '2026-12-01T12:00:00.000Z',
  }) as Appointment;

async function refusal(promise: Promise<unknown>): Promise<CremationReleaseError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CremationReleaseError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('approveCremationRelease', () => {
  it('a verified funeral director is refused while prerequisites are unmet; nothing is written', async () => {
    appointmentFixtures.push(completedViewing());
    const before = JSON.stringify(caseFixtures.find((c) => c.id === 'gus-case-010' && c.organizationId === GUS));
    const error = await refusal(approveCremationRelease(director, 'gus-case-010', 'mock'));
    expect(error.status).toBe(409);
    expect(error.evaluation!.prerequisites.find((p) => p.key === 'approver_licensed')!.met).toBe(true);
    expect(error.evaluation!.prerequisites.find((p) => p.key === 'approver_authorized')!.met).toBe(true);
    expect(error.evaluation!.prerequisites.find((p) => p.key === 'service_completed')!.met).toBe(true);
    expect(error.evaluation!.prerequisites.find((p) => p.key === 'medical_examiner_approval')!.met).toBe(false);
    expect(JSON.stringify(caseFixtures.find((c) => c.id === 'gus-case-010' && c.organizationId === GUS))).toBe(before);
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('the administrator (allowed role, display role "funeral director", no license) is refused as unauthorized', async () => {
    const error = await refusal(approveCremationRelease(admin, 'gus-case-010', 'mock'));
    expect(error.status).toBe(403);
    expect(error.evaluation!.prerequisites.find((p) => p.key === 'approver_licensed')!.detail).toMatch(/No funeral director license/);
  });

  it('a read-only user is refused as unauthorized', async () => {
    expect((await refusal(approveCremationRelease(viewer, 'gus-case-010', 'mock'))).status).toBe(403);
  });

  it('Direct Cremation, Manors and another organization’s case have no release here', async () => {
    expect((await refusal(approveCremationRelease(director, 'gus-case-001', 'mock'))).status).toBe(404);
    expect((await refusal(approveCremationRelease({ ...director, organizationId: DEFAULT_ORGANIZATION_ID }, 'gus-case-010', 'mock'))).status).toBe(404);
    const manorsCase = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!;
    expect(await evaluateCremationReleaseForCaller({ organizationId: DEFAULT_ORGANIZATION_ID, userId: 'identity-1', role: 'administrator' }, manorsCase.id, 'mock')).toBeNull();
  });

  it('works out the evaluation for the person asking (shown on the card)', async () => {
    const forDirector = (await evaluateCremationReleaseForCaller(director, 'gus-case-010', 'mock'))!;
    const forAdmin = (await evaluateCremationReleaseForCaller(admin, 'gus-case-010', 'mock'))!;
    expect(forDirector.prerequisites.find((p) => p.key === 'approver_licensed')!.met).toBe(true);
    expect(forAdmin.prerequisites.find((p) => p.key === 'approver_licensed')!.met).toBe(false);
    expect(forDirector.canRelease).toBe(false);
  });
});
