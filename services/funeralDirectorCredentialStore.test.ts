import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FuneralDirectorCredentialRecord } from '../domain/staff/funeralDirectorCredentials';

/**
 * Live credential storage adapter (Gus Phase 5H.1), tested with the live
 * switch ON in this file only and every Wix call stubbed — nothing reaches
 * Wix. Fictional organization, staff and license data.
 */
vi.mock('./funeralDirectorCredentialSwitch', () => ({ funeralDirectorCredentialsLive: () => true }));
const wix = vi.hoisted(() => ({
  insert: vi.fn(),
  patch: vi.fn(),
  query: vi.fn(),
}));
vi.mock('../lib/wixDataApi', async () => {
  const actual = await vi.importActual<typeof import('../lib/wixDataApi')>('../lib/wixDataApi');
  return { ...actual, insertWixDataItem: wix.insert, conditionalPatchWixDataItemFields: wix.patch, queryWixDataItems: wix.query };
});
const { credentialRecordId, mapWixCredentialItem, readCredentialRecord, writeCredentialRecord, CredentialStorageUnreadableError } = await import('./funeralDirectorCredentialStore');
const { WixDataApiError } = await import('../lib/wixDataApi');

const ORG = 'gus-camacho-jr';
const STAFF = 'staff-gus-director';
const ID = 'fdc.gus-camacho-jr.staff-gus-director';
const base = (revision: number, eventIds: string[] = []): FuneralDirectorCredentialRecord => ({
  organizationId: ORG,
  staffProfileId: STAFF,
  identityId: 'identity-gus-director',
  license: null,
  authorization: null,
  revision,
  history: eventIds.map((eventId) => ({ eventId, action: 'license_set', reason: null, before: { license: null, authorization: null }, after: { license: null, authorization: null }, actorId: 'identity-gus-admin', actorName: 'Avery Demo', at: '2026-11-18T12:00:00.000Z' })),
});
const stored = (record: FuneralDirectorCredentialRecord) => ({ id: ID, data: { organizationId: record.organizationId, staffProfileId: record.staffProfileId, identityId: record.identityId, license: record.license, authorization: record.authorization, history: record.history, revision: record.revision } });
const NOW = '2026-11-18T12:00:00.000Z';

beforeEach(() => {
  wix.insert.mockReset();
  wix.patch.mockReset();
  wix.query.mockReset();
});

describe('record id', () => {
  it('is fdc.{organizationId}.{staffProfileId}, within Wix’s 128 characters', () => {
    expect(credentialRecordId(ORG, STAFF)).toBe(ID);
    expect(credentialRecordId(ORG, '0f71609a-b21f-4691-9408-892390832bee').length).toBeLessThanOrEqual(128);
  });

  it('refuses parts that could collide or break the id (only letters, digits, hyphens)', () => {
    expect(() => credentialRecordId('a.b', 'c')).toThrow();
    expect(() => credentialRecordId('a', 'b.c')).toThrow();
    expect(() => credentialRecordId('a:b', 'c')).toThrow();
    // Two different pairs can never meet on the same id.
    const pairs = [['gus-camacho-jr', 'staff-1'], ['gus-camacho', 'jr-staff-1'], ['gus', 'camacho-jr-staff-1']] as const;
    expect(new Set(pairs.map(([o, st]) => credentialRecordId(o, st))).size).toBe(pairs.length);
    expect(() => credentialRecordId('', STAFF)).toThrow();
    expect(() => credentialRecordId(ORG, 'x'.repeat(120))).toThrow(/128/);
  });
});

describe('reading', () => {
  it('maps only the record for the organization and staff member asked for', () => {
    expect(mapWixCredentialItem(ID, stored(base(1, ['e1'])).data, { organizationId: ORG, staffProfileId: STAFF })?.revision).toBe(1);
    expect(mapWixCredentialItem(ID, { ...stored(base(1)).data, organizationId: 'managed-cremations' }, { organizationId: ORG, staffProfileId: STAFF })).toBeNull();
    expect(mapWixCredentialItem('fdc.managed-cremations.staff-gus-director', stored(base(1)).data, { organizationId: ORG, staffProfileId: STAFF })).toBeNull();
  });

  it('a stored record that cannot be read is an error, never "no credentials"', async () => {
    wix.query.mockResolvedValue({ dataItems: [{ id: ID, data: { ...stored(base(1)).data, history: [{ no: 'id' }] } }] });
    await expect(readCredentialRecord(ORG, STAFF, 'wix')).rejects.toBeInstanceOf(CredentialStorageUnreadableError);
  });
});

describe('writing', () => {
  it('first record: inserted with the deterministic id; a duplicate (409) is a conflict', async () => {
    wix.insert.mockResolvedValueOnce({ id: ID, data: {} });
    expect((await writeCredentialRecord(base(0), base(1, ['e1']), 'wix', NOW)).result).toBe('applied');
    expect(wix.insert.mock.calls[0][2]).toBe(ID);
    expect(wix.insert.mock.calls[0][1]).toMatchObject({ organizationId: ORG, staffProfileId: STAFF, identityId: 'identity-gus-director', revision: 1, history: [{ eventId: 'e1' }] });
    wix.insert.mockRejectedValueOnce(new WixDataApiError('exists', 409));
    expect((await writeCredentialRecord(base(0), base(1, ['e2']), 'wix', NOW)).result).toBe('conflict');
  });

  it('later changes: one conditional patch on the read revision, with the credentials and history together', async () => {
    wix.patch.mockResolvedValueOnce({ applied: true, dataItem: { id: ID, data: {} } });
    const result = await writeCredentialRecord(base(1, ['e1']), base(2, ['e1', 'e2']), 'wix', NOW);
    expect(result.result).toBe('applied');
    const [collection, id, fields, condition] = wix.patch.mock.calls[0];
    expect(collection).toBe('funeralDirectorCredentials');
    expect(id).toBe(ID);
    expect(Object.keys(fields).sort()).toEqual(['authorization', 'history', 'license', 'revision', 'updatedAt']);
    expect(fields.history.map((h: { eventId: string }) => h.eventId)).toEqual(['e1', 'e2']);
    expect(condition).toEqual({ filter: { revision: 1, organizationId: ORG, staffProfileId: STAFF } });
  });

  it('a stale revision (428) is a conflict — nothing overwritten, no retry', async () => {
    wix.patch.mockResolvedValueOnce({ applied: false, status: 428 });
    expect((await writeCredentialRecord(base(1, ['e1']), base(2, ['e1', 'e2']), 'wix', NOW)).result).toBe('conflict');
    expect(wix.patch).toHaveBeenCalledTimes(1);
  });

  it('an unclear answer is settled by reading back: saved', async () => {
    wix.patch.mockRejectedValueOnce(new Error('socket hang up'));
    wix.query.mockResolvedValueOnce({ dataItems: [stored(base(2, ['e1', 'e2']))] });
    expect((await writeCredentialRecord(base(1, ['e1']), base(2, ['e1', 'e2']), 'wix', NOW)).result).toBe('applied');
    expect(wix.patch).toHaveBeenCalledTimes(1);
  });

  it('an unclear answer is settled by reading back: not saved; or unclear if it cannot be read', async () => {
    wix.patch.mockResolvedValueOnce({ applied: false, status: 500 });
    wix.query.mockResolvedValueOnce({ dataItems: [stored(base(1, ['e1']))] });
    expect((await writeCredentialRecord(base(1, ['e1']), base(2, ['e1', 'e2']), 'wix', NOW)).result).toBe('not_saved');
    wix.patch.mockResolvedValueOnce({ applied: false, status: 500 });
    wix.query.mockRejectedValueOnce(new Error('Wix down'));
    expect((await writeCredentialRecord(base(1, ['e1']), base(2, ['e1', 'e2']), 'wix', NOW)).result).toBe('unclear');
  });
});
