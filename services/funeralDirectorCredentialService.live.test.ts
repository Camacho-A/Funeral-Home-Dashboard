import { beforeEach, describe, expect, it, vi } from 'vitest';
import { funeralDirectorCredentialsLive } from './funeralDirectorCredentialSwitch';

/**
 * Funeral director credentials through the LIVE (Wix) path — Gus Phase 5I.
 * The live switch is on in this file only, and Wix is replaced by a small
 * in-memory fake with Wix's two guarantees: a duplicate item id is refused
 * (409), and a conditional patch whose condition no longer holds is
 * refused whole (428). Nothing reaches Wix. Fictional people and licenses.
 */
vi.mock('./funeralDirectorCredentialSwitch', async () => {
  const actual = await vi.importActual<typeof import('./funeralDirectorCredentialSwitch')>('./funeralDirectorCredentialSwitch');
  return { ...actual, funeralDirectorCredentialsLive: () => true };
});

type Item = { id: string; data: Record<string, unknown> };
const fake = vi.hoisted(() => ({ items: new Map<string, Item>(), patchHook: null as null | (() => void) }));
vi.mock('../lib/wixDataApi', async () => {
  const actual = await vi.importActual<typeof import('../lib/wixDataApi')>('../lib/wixDataApi');
  return {
    ...actual,
    insertWixDataItem: vi.fn(async (_c: string, data: Record<string, unknown>, id: string) => {
      if (fake.items.has(id)) throw new actual.WixDataApiError('exists', 409);
      fake.items.set(id, { id, data: structuredClone(data) });
      return { id, data };
    }),
    conditionalPatchWixDataItemFields: vi.fn(async (_c: string, id: string, fields: Record<string, unknown>, condition: { filter: Record<string, unknown> }) => {
      fake.patchHook?.();
      const item = fake.items.get(id);
      if (!item || !Object.entries(condition.filter).every(([k, v]) => item.data[k] === v)) return { applied: false, status: 428 };
      item.data = { ...item.data, ...structuredClone(fields) };
      return { applied: true, dataItem: item };
    }),
    queryWixDataItems: vi.fn(async (_c: string, query: { filter: Record<string, unknown> }) => ({
      dataItems: [...fake.items.values()].filter((i) => Object.entries(query.filter).every(([k, v]) => i.data[k] === v)).map((i) => structuredClone(i)),
    })),
  };
});
const staff = vi.hoisted(() => [
  { id: 'staff-gus-admin', organizationId: 'gus-camacho-jr', identityId: 'identity-gus-admin', membershipId: null, displayName: 'Avery Demo', role: 'funeral_director', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'staff-gus-director', organizationId: 'gus-camacho-jr', identityId: 'identity-gus-director', membershipId: null, displayName: 'Jordan Demo', role: 'funeral_director', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'staff-gus-admin-2', organizationId: 'gus-camacho-jr', identityId: 'identity-gus-admin-2', membershipId: null, displayName: 'Casey Demo', role: 'admin', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'staff-manors-1', organizationId: 'managed-cremations', identityId: 'identity-manors-1', membershipId: null, displayName: 'Fictional Manors', role: 'staff', isActive: true, createdAt: '', updatedAt: '' },
]);
vi.mock('./staffProfileService', () => ({
  list: vi.fn(async (organizationId: string) => staff.filter((s) => s.organizationId === organizationId && s.isActive)),
  assertStaffProfileIsActiveAndInOrganization: vi.fn(async (organizationId: string, id: string) => {
    const found = staff.find((s) => s.id === id && s.organizationId === organizationId && s.isActive);
    if (!found) throw new Error('not in organization');
    return found;
  }),
}));
vi.mock('./activityService', async () => ({ ...(await vi.importActual<object>('./activityService')), recordFuneralDirectorCredentialChange: vi.fn(async () => undefined) }));

const { changeCredentials, listCredentialSummaries } = await import('./funeralDirectorCredentialService');

const GUS = 'gus-camacho-jr';
const ctx = (actorIdentityId: string, organizationId = GUS) => ({ organizationId, actorIdentityId, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c' });
const license = { kind: 'set_license' as const, licenseNumber: 'FD-FICTIONAL-0001', state: 'FL', licenseType: 'funeral_director_and_embalmer', status: 'active' as const, expiresOn: '2030-01-31' };
const change = (actor: string, staffProfileId: string, c: Parameters<typeof changeCredentials>[1]['change'], expectedRevision: number, org = GUS) =>
  changeCredentials(ctx(actor, org), { staffProfileId, change: c, expectedRevision, actorName: actor === 'identity-gus-admin' ? 'Avery Demo' : 'Casey Demo' }, 'wix');
const director = async () => (await listCredentialSummaries(GUS, 'wix')).find((s) => s.staffProfileId === 'staff-gus-director')!;

beforeEach(() => {
  fake.items.clear();
  fake.patchHook = null;
});

describe('live credential storage (fake Wix)', () => {
  it('creates the record under its deterministic id, edits it, and reads it back after a reload', async () => {
    await change('identity-gus-admin', 'staff-gus-director', license, 0);
    expect([...fake.items.keys()]).toEqual(['fdc.gus-camacho-jr.staff-gus-director']);
    await change('identity-gus-admin', 'staff-gus-director', { kind: 'verify_license', method: 'state_license_lookup', reference: 'Fictional lookup' }, 1);
    const reloaded = await director();
    expect(reloaded.record).toMatchObject({ revision: 2, identityId: 'identity-gus-director' });
    expect(reloaded.licenseCheck.verified).toBe(true);
    expect(reloaded.record!.history.map((h) => h.action)).toEqual(['license_set', 'license_verified']);
  });

  it('two administrators changing the same person at once: one wins, the other gets a conflict — nothing overwritten', async () => {
    await change('identity-gus-admin', 'staff-gus-director', license, 0);
    // Both read revision 1; the second admin's save lands first.
    fake.patchHook = () => {
      fake.patchHook = null;
      const item = fake.items.get('fdc.gus-camacho-jr.staff-gus-director')!;
      item.data = { ...item.data, revision: 2, history: [...(item.data.history as unknown[]), { eventId: 'other-admin', action: 'authorization_granted' }] };
    };
    await expect(change('identity-gus-admin', 'staff-gus-director', { kind: 'grant_authorization' }, 1)).rejects.toMatchObject({ status: 409 });
    const stored = fake.items.get('fdc.gus-camacho-jr.staff-gus-director')!.data;
    expect((stored.history as { eventId: string }[]).map((h) => h.eventId).at(-1)).toBe('other-admin');
  });

  it('two administrators creating the same person’s first record: the duplicate id is refused', async () => {
    await change('identity-gus-admin', 'staff-gus-director', license, 0);
    // A second admin who still saw "no record" (revision 0) is refused.
    await expect(change('identity-gus-admin-2', 'staff-gus-director', license, 0)).rejects.toMatchObject({ status: 409 });
    expect(fake.items.size).toBe(1);
  });

  it('history is append-only across edits, and an expired license is not verified', async () => {
    await change('identity-gus-admin', 'staff-gus-director', license, 0);
    await change('identity-gus-admin', 'staff-gus-director', { kind: 'verify_license', method: 'state_license_lookup', reference: 'Fictional lookup' }, 1);
    const before = (await director()).record!.history;
    await change('identity-gus-admin', 'staff-gus-director', { ...license, expiresOn: '2020-01-31' }, 2);
    const after = await director();
    expect(after.record!.history.slice(0, 2)).toEqual(before);
    expect(after.licenseCheck.verified).toBe(false);
  });

  it('no self-entry, self-verification or self-authorization; another organization’s staff are not reachable', async () => {
    await expect(change('identity-gus-admin', 'staff-gus-admin', { kind: 'grant_authorization' }, 0)).rejects.toMatchObject({ status: 403 });
    await expect(change('identity-gus-admin', 'staff-manors-1', license, 0)).rejects.toMatchObject({ status: 404 });
    expect(fake.items.size).toBe(0);
  });
});

describe('the live switch', () => {
  it('is on only when a deployment sets SOLIS_FD_CREDENTIALS_STORAGE=wix with DATA_ADAPTER=wix', async () => {
    const real = (await vi.importActual<typeof import('./funeralDirectorCredentialSwitch')>('./funeralDirectorCredentialSwitch')).funeralDirectorCredentialsLive;
    expect(real({})).toBe(false);
    expect(real({ DATA_ADAPTER: 'wix' })).toBe(false); // Manors Production today
    expect(real({ DATA_ADAPTER: 'mock', SOLIS_FD_CREDENTIALS_STORAGE: 'wix' })).toBe(false); // sandboxes
    expect(real({ DATA_ADAPTER: 'wix', SOLIS_FD_CREDENTIALS_STORAGE: 'true' })).toBe(false);
    expect(real({ DATA_ADAPTER: 'wix', SOLIS_FD_CREDENTIALS_STORAGE: 'wix' })).toBe(true);
    void funeralDirectorCredentialsLive;
  });
});
