import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { funeralDirectorCredentialFixtures } from './__mocks__/funeralDirectorCredentialFixtures';
import { buildGusCredentialFixtures } from './__mocks__/gusFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import { staffFixtures } from './__mocks__/fixtures';

const wix = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../lib/wixDataApi', async () => {
  const actual = await vi.importActual<object>('../lib/wixDataApi');
  const refuse = () => {
    wix.calls += 1;
    throw new Error('Wix must not be called');
  };
  return { ...actual, queryWixDataItems: refuse, queryAllWixDataItems: refuse, updateWixDataItem: refuse, insertWixDataItem: refuse };
});
const { changeCredentials, listCredentialSummaries } = await import('./funeralDirectorCredentialService');
const { evaluateCremationReleaseForCaller } = await import('./cremationReleaseService');

/** Funeral director credentials (Gus Phase 5G) — mock mode, fictional people. */
const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const adminCtx = { organizationId: GUS, actorIdentityId: 'identity-gus-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c' };
const directorCtx = { ...adminCtx, actorIdentityId: 'identity-gus-director', actorRoleKey: 'funeralDirector' };
const releaseCheck = async (userId: string, role: string) => {
  const e = (await evaluateCremationReleaseForCaller({ organizationId: GUS, userId, role }, 'gus-case-010', 'mock'))!;
  return { authorized: e.prerequisites.find((p) => p.key === 'approver_authorized')!.met, licensed: e.prerequisites.find((p) => p.key === 'approver_licensed')!.met, canRelease: e.canRelease };
};

beforeEach(() => {
  funeralDirectorCredentialFixtures.length = 0;
  funeralDirectorCredentialFixtures.push(...buildGusCredentialFixtures());
  activityEventFixtures.length = 0;
  wix.calls = 0;
});

describe('funeral director credentials (server)', () => {
  it('lists every staff member with their record and license check', async () => {
    const staff = await listCredentialSummaries(GUS, 'mock');
    const director = staff.find((s) => s.displayName === 'Jordan Demo')!;
    expect(director.licenseCheck.verified).toBe(true);
    expect(director.record!.history.map((h) => h.action)).toEqual(['license_set', 'license_verified']);
    expect(staff.find((s) => s.displayName === 'Avery Demo')!.record).toBeNull();
  });

  it('the verified Funeral Director satisfies the identity and permission checks; the administrator does not', async () => {
    expect(await releaseCheck('identity-gus-director', 'funeralDirector')).toEqual({ authorized: true, licensed: true, canRelease: false });
    expect(await releaseCheck('identity-gus-admin', 'administrator')).toEqual({ authorized: false, licensed: false, canRelease: false });
  });

  it('nobody changes their own credentials (403), and nothing is recorded', async () => {
    await expect(changeCredentials(adminCtx, { staffProfileId: 'staff-gus-admin', change: { kind: 'grant_authorization' }, expectedRevision: 0, actorName: 'Avery Demo' }, 'mock')).rejects.toMatchObject({ status: 403 });
    expect(funeralDirectorCredentialFixtures.find((r) => r.staffProfileId === 'staff-gus-admin')).toBeUndefined();
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('an administrator authorized AND licensed by others passes the approver checks — still without release', async () => {
    await changeCredentials(directorCtx, { staffProfileId: 'staff-gus-admin', change: { kind: 'grant_authorization' }, expectedRevision: 0, actorName: 'Jordan Demo' }, 'mock');
    expect(await releaseCheck('identity-gus-admin', 'administrator')).toMatchObject({ authorized: true, licensed: false });
    await changeCredentials(directorCtx, { staffProfileId: 'staff-gus-admin', change: { kind: 'set_license', licenseNumber: 'FD-FICTIONAL-0002', state: 'FL', licenseType: 'funeral_director', status: 'active', expiresOn: '2030-01-31' }, expectedRevision: 1, actorName: 'Jordan Demo' }, 'mock');
    expect(await releaseCheck('identity-gus-admin', 'administrator')).toMatchObject({ authorized: true, licensed: false });
    await changeCredentials(directorCtx, { staffProfileId: 'staff-gus-admin', change: { kind: 'verify_license', method: 'state_license_lookup', reference: 'Fictional lookup' }, expectedRevision: 2, actorName: 'Jordan Demo' }, 'mock');
    expect(await releaseCheck('identity-gus-admin', 'administrator')).toEqual({ authorized: true, licensed: true, canRelease: false });
  });

  it('expired or unverified licenses are rejected for release', async () => {
    await changeCredentials(adminCtx, { staffProfileId: 'staff-gus-director', change: { kind: 'set_license', licenseNumber: 'FD-FICTIONAL-0001', state: 'FL', licenseType: 'funeral_director', status: 'active', expiresOn: '2020-01-31' }, expectedRevision: 2, actorName: 'Avery Demo' }, 'mock');
    expect(await releaseCheck('identity-gus-director', 'funeralDirector')).toMatchObject({ authorized: true, licensed: false });
  });

  it('a change made against an older revision is refused (409)', async () => {
    await expect(changeCredentials(adminCtx, { staffProfileId: 'staff-gus-director', change: { kind: 'grant_authorization' }, expectedRevision: 1, actorName: 'Avery Demo' }, 'mock')).rejects.toMatchObject({ status: 409 });
  });

  it('every change is in the record history and is one Activity event with the same id', async () => {
    const record = await changeCredentials(adminCtx, { staffProfileId: 'staff-gus-director', change: { kind: 'grant_authorization' }, expectedRevision: 2, actorName: 'Avery Demo' }, 'mock');
    const last = record.history[record.history.length - 1];
    expect(last).toMatchObject({ action: 'authorization_granted', actorId: 'identity-gus-admin', actorName: 'Avery Demo' });
    const events = activityEventFixtures.filter((e) => e.eventType === ACTIVITY_EVENT_TYPES.FUNERAL_DIRECTOR_CREDENTIAL_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ correlationId: last.eventId, resourceId: 'staff-gus-director', organizationId: GUS });
  });

  it('is Gus-only, organization-scoped, and never writes to a live site', async () => {
    await expect(listCredentialSummaries(DEFAULT_ORGANIZATION_ID, 'mock')).rejects.toMatchObject({ status: 404 });
    await expect(changeCredentials({ ...adminCtx, organizationId: DEFAULT_ORGANIZATION_ID }, { staffProfileId: 'staff-gus-director', change: { kind: 'grant_authorization' }, expectedRevision: 2, actorName: null }, 'mock')).rejects.toMatchObject({ status: 404 });
    await expect(changeCredentials(adminCtx, { staffProfileId: 'staff-gus-director', change: { kind: 'grant_authorization' }, expectedRevision: 2, actorName: null }, 'wix')).rejects.toMatchObject({ status: 503 });
    expect(wix.calls).toBe(0);
  });

  it('the owner is established on the server: another organization’s staff member, or an inactive one, is refused', async () => {
    const manorsStaff = staffFixtures.find((st) => st.organizationId === DEFAULT_ORGANIZATION_ID)!;
    await expect(changeCredentials(adminCtx, { staffProfileId: manorsStaff.id, change: { kind: 'grant_authorization' }, expectedRevision: 0, actorName: null }, 'mock')).rejects.toMatchObject({ status: 404 });
    const viewerIndex = staffFixtures.findIndex((st) => st.id === 'staff-gus-viewer');
    const viewer = staffFixtures[viewerIndex];
    staffFixtures[viewerIndex] = { ...viewer, isActive: false };
    try {
      await expect(changeCredentials(adminCtx, { staffProfileId: 'staff-gus-viewer', change: { kind: 'grant_authorization' }, expectedRevision: 0, actorName: null }, 'mock')).rejects.toMatchObject({ status: 404 });
    } finally {
      staffFixtures[viewerIndex] = viewer;
    }
  });

  it('a record at the size limit refuses the change (413) and keeps its history', async () => {
    const record = funeralDirectorCredentialFixtures[0];
    const padded = { ...record, history: [...record.history, ...Array.from({ length: 400 }, (_, i) => ({ ...record.history[0], eventId: `pad-${i}`, reason: 'x'.repeat(300) }))] };
    funeralDirectorCredentialFixtures[0] = padded;
    await expect(changeCredentials(adminCtx, { staffProfileId: 'staff-gus-director', change: { kind: 'grant_authorization' }, expectedRevision: 2, actorName: null }, 'mock')).rejects.toMatchObject({ status: 413 });
    expect(funeralDirectorCredentialFixtures[0]).toBe(padded);
    expect(activityEventFixtures).toHaveLength(0);
  });
});
