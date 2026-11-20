import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { funeralDirectorCredentialFixtures } from './__mocks__/funeralDirectorCredentialFixtures';
import { buildGusCredentialFixtures } from './__mocks__/gusFixtures';
import { completedViewingAppointment, releaseReadyViewingCase } from './__mocks__/gusReleaseFixtures';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import type { Appointment } from '../types/appointment';

/**
 * A Gus Cremation with Viewing, end to end (Gus Phase 5M regression) —
 * mock mode, fictional people. Two switches are turned on IN THIS FILE
 * ONLY so the whole path can run: release for cremation, and the Send to
 * Crematory release gate for Gus. Both are off in the code. Nothing is sent.
 */
vi.mock('../domain/servicePreparation/releaseForCremation', async () => ({
  ...(await vi.importActual<object>('../domain/servicePreparation/releaseForCremation')),
  RELEASE_FOR_CREMATION_AVAILABLE: true,
}));
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/organization/organizationProfiles')>();
  return {
    ...actual,
    getRegisteredOrganizationProfile: (organizationId: string) => {
      const profile = actual.getRegisteredOrganizationProfile(organizationId);
      if (organizationId !== actual.GUS_CAMACHO_ORGANIZATION_ID) return profile;
      return { ...profile, features: { ...profile.features, sendToCrematory: { ...profile.features.sendToCrematory!, requireReleaseAfterService: true } } };
    },
  };
});

const { changeServicePreparation, getServicePreparation } = await import('./servicePreparationService');
const { recordMedicalExaminerApprovalForCase } = await import('./medicalExaminerApprovalService');
const { changeCredentials, getCredentialRecord } = await import('./funeralDirectorCredentialService');
const { approveCremationRelease, evaluateCremationReleaseForCaller } = await import('./cremationReleaseService');
const { getCrematoryCaseSummary } = await import('./crematory/crematoryPackageService');
const { listUpcomingServices } = await import('./upcomingServicesService');
const { GUS_CAMACHO_ORGANIZATION_ID } = await import('../domain/organization/organizationProfiles');

const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const CASE = 'gus-case-010';
const NOW = new Date().toISOString();
const DAY = 24 * 60 * 60 * 1000;
const admin = { organizationId: GUS, userId: 'identity-gus-admin', role: 'administrator' };
const director = { organizationId: GUS, userId: 'identity-gus-director', role: 'funeralDirector' };
const ctxOf = (who: typeof admin, name: string) => ({ ctx: { organizationId: GUS, actorIdentityId: who.userId, actorMembershipId: null, actorRoleKey: who.role, correlationId: 'c' }, name });

const originals = caseFixtures.map((c) => c);
const index = () => caseFixtures.findIndex((c) => c.id === CASE && c.organizationId === GUS);
const releaseGate = async () => (await getCrematoryCaseSummary(GUS, CASE, true, 'mock')).readiness.requirements.find((r) => r.key === 'released_for_cremation');
const refusalStatus = async (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);

beforeEach(() => {
  activityEventFixtures.length = 0;
  appointmentFixtures.length = 0;
  funeralDirectorCredentialFixtures.length = 0;
  funeralDirectorCredentialFixtures.push(...buildGusCredentialFixtures(new Date(NOW)));
  // Legal steps, the permit and the date of death are in place; preparation and the ME approval are not.
  caseFixtures[index()] = releaseReadyViewingCase(originals[index()], NOW, { servicePreparation: null });
  const c = caseFixtures[index()];
  caseFixtures[index()] = { ...c, crematory: { ...c.crematory, medicalExaminerApproval: null } };
});
afterEach(() => originals.forEach((c, i) => (caseFixtures[i] = c)));

describe('Gus Cremation with Viewing — from scheduling to release', () => {
  it('runs the whole path, with every safeguard holding along the way', async () => {
    // 1. The Viewing (held yesterday, not yet marked completed) is on the Dashboard with work to do.
    const viewing: Appointment = { ...completedViewingAppointment(GUS, CASE, NOW), status: 'scheduled' };
    appointmentFixtures.push(viewing);
    const [upcoming] = (await listUpcomingServices(GUS, 'mock', NOW))!;
    expect(upcoming).toMatchObject({ caseId: CASE, serviceName: 'Viewing', completed: 0, awaitingRelease: true });
    expect(await releaseGate()).toMatchObject({ ok: false });

    // 2. Staff record the embalming authorization and identification.
    const staff = ctxOf(admin, 'Avery Demo');
    for (const itemId of ['prep.embalming.written_permission', 'prep.day_of.identification_verified']) {
      await changeServicePreparation(staff.ctx, CASE, { change: { kind: 'item', itemId, status: 'completed' }, basis: { at: null }, actorName: staff.name, now: NOW }, 'mock');
    }
    expect((await listUpcomingServices(GUS, 'mock', NOW))![0].completed).toBe(2);

    // 3. Before the Viewing is marked completed, even the licensed director is refused.
    expect(await refusalStatus(approveCremationRelease(director, CASE, 'mock', { now: NOW }))).toBe(409);

    // 4. The Viewing is held; the ME approval is still missing, so release is refused.
    appointmentFixtures[0] = { ...viewing, status: 'completed' };
    const unmet = (await evaluateCremationReleaseForCaller(director, CASE, 'mock', NOW))!.prerequisites.filter((p) => !p.met).map((p) => p.key);
    expect(unmet).toEqual(['medical_examiner_approval']);
    expect(await refusalStatus(approveCremationRelease(director, CASE, 'mock', { now: NOW }))).toBe(409);

    // 5. Staff record the ME cremation approval they confirmed in EDRS.
    await recordMedicalExaminerApprovalForCase(
      staff.ctx,
      CASE,
      { confirmedInEdrs: true, approvalDate: new Date(Date.parse(NOW) - 2 * DAY).toISOString().slice(0, 10), reference: 'EDRS-FICTIONAL-2002', evidenceDocumentId: null, evidenceSource: 'EDRS case status screen (fictional)', reason: null, actorName: staff.name, now: NOW },
      'mock',
    );
    expect((await evaluateCremationReleaseForCaller(director, CASE, 'mock', NOW))!.allPrerequisitesMet).toBe(true);

    // 6. The administrator is not a Funeral Director: refused. Nor can they authorize themselves.
    expect(await refusalStatus(approveCremationRelease(admin, CASE, 'mock', { now: NOW }))).toBe(403);
    expect(await refusalStatus(changeCredentials(staff.ctx, { staffProfileId: 'staff-gus-admin', change: { kind: 'grant_authorization' }, expectedRevision: 0, actorName: staff.name }, 'mock'))).toBe(403);

    // 7. The director (someone else) enters and verifies the administrator's license and authorizes them.
    const dir = ctxOf(director, 'Jordan Demo');
    const adminStaffId = 'staff-gus-admin';
    await changeCredentials(dir.ctx, { staffProfileId: adminStaffId, change: { kind: 'set_license', licenseNumber: 'FD-FICTIONAL-0002', state: 'FL', licenseType: 'funeral_director', status: 'active', expiresOn: '2030-06-30' }, expectedRevision: 0, actorName: dir.name, now: NOW }, 'mock');
    await changeCredentials(dir.ctx, { staffProfileId: adminStaffId, change: { kind: 'verify_license', method: 'state_license_lookup', reference: 'Fictional state lookup' }, expectedRevision: 1, actorName: dir.name, now: NOW }, 'mock');
    await changeCredentials(dir.ctx, { staffProfileId: adminStaffId, change: { kind: 'grant_authorization' }, expectedRevision: 2, actorName: dir.name, now: NOW }, 'mock');
    expect((await getCredentialRecord(GUS, adminStaffId, 'mock'))!.history.map((h) => h.action)).toEqual(['license_set', 'license_verified', 'authorization_granted']);

    // 8. Now the authorized, licensed administrator releases.
    const { release } = await approveCremationRelease(admin, CASE, 'mock', { now: NOW, eventId: 'lifecycle-release' });
    expect(release.approval).toMatchObject({ basis: 'funeral_director_authorization', licenseNumber: 'FD-FICTIONAL-0002' });

    // 9. Afterwards: the send requirement is met, the Dashboard drops it, preparation is read-only, and a second release is refused.
    expect(await releaseGate()).toMatchObject({ ok: true });
    expect(await listUpcomingServices(GUS, 'mock', NOW)).toEqual([]);
    expect(await refusalStatus(changeServicePreparation(staff.ctx, CASE, { change: { kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' }, basis: { at: null }, actorName: staff.name }, 'mock'))).toBe(400);
    expect(await refusalStatus(approveCremationRelease(director, CASE, 'mock', { now: NOW }))).toBe(409);
    const prep = (await getServicePreparation(GUS, CASE, 'mock'))!.record!;
    expect(prep.history!.map((h) => h.target.kind)).toEqual(['item', 'item', 'release']);

    // Activity: two preparation changes, the ME approval, three credential changes, one release — and nothing sent.
    const types = activityEventFixtures.map((e) => e.eventType);
    expect(types.filter((t) => t === ACTIVITY_EVENT_TYPES.SERVICE_PREPARATION_UPDATED)).toHaveLength(2);
    expect(types.filter((t) => t === ACTIVITY_EVENT_TYPES.MEDICAL_EXAMINER_APPROVAL_RECORDED)).toHaveLength(1);
    expect(types.filter((t) => t === ACTIVITY_EVENT_TYPES.FUNERAL_DIRECTOR_CREDENTIAL_CHANGED)).toHaveLength(3);
    expect(types.filter((t) => t === ACTIVITY_EVENT_TYPES.CASE_RELEASED_FOR_CREMATION)).toHaveLength(1);
    expect(types.some((t) => /crematory\.(sent|send)/.test(t))).toBe(false);
  });
});
