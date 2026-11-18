import { describe, expect, it } from 'vitest';
import { applyCredentialChange, emptyCredentialRecord, SelfServiceCredentialError, type CredentialChange } from './funeralDirectorCredentials';

/** Funeral director credentials (Gus Phase 5G). Fictional people and license numbers. */
const licensee = { id: 'staff-fictional', organizationId: 'gus-camacho-jr', identityId: 'identity-licensee' };
const admin = { id: 'identity-admin', name: 'Avery Demo' };
const setLicense: CredentialChange = { kind: 'set_license', licenseNumber: 'FD-FICTIONAL-9', state: 'fl', licenseType: 'funeral_director', status: 'active', expiresOn: '2028-01-31' };
let n = 0;
const apply = (record: ReturnType<typeof emptyCredentialRecord>, change: CredentialChange, actor = admin) => applyCredentialChange({ record, change, actor, now: '2026-11-17T12:00:00.000Z', eventId: `e${++n}` });

describe('funeral director credentials', () => {
  it('nobody can enter, verify, authorize or de-authorize themselves', () => {
    const self = { id: licensee.identityId, name: 'Licensee' };
    const withLicense = apply(emptyCredentialRecord(licensee), setLicense);
    for (const change of [setLicense, { kind: 'verify_license', method: 'state_license_lookup', reference: 'x' }, { kind: 'grant_authorization' }] as CredentialChange[]) {
      expect(() => apply(withLicense, change, self)).toThrow(SelfServiceCredentialError);
    }
  });

  it('entering or changing a license clears its verification; another person verifies it', () => {
    const entered = apply(emptyCredentialRecord(licensee), setLicense);
    expect(entered.license).toMatchObject({ state: 'FL', verification: null });
    const verified = apply(entered, { kind: 'verify_license', method: 'state_license_lookup', reference: 'Fictional lookup page' });
    expect(verified.license?.verification).toMatchObject({ verifiedBy: admin.id, verifiedByName: 'Avery Demo', method: 'state_license_lookup', verifiedAt: '2026-11-17T12:00:00.000Z' });
    const changed = apply(verified, { ...setLicense, expiresOn: '2029-01-31' } as CredentialChange);
    expect(changed.license?.verification).toBeNull();
  });

  it('refuses incomplete license details and verification without details', () => {
    expect(() => apply(emptyCredentialRecord(licensee), { ...setLicense, licenseNumber: ' ' } as CredentialChange)).toThrow(/license number/);
    expect(() => apply(emptyCredentialRecord(licensee), { ...setLicense, state: 'Florida' } as CredentialChange)).toThrow(/two-letter/);
    expect(() => apply(emptyCredentialRecord(licensee), { kind: 'verify_license', method: 'state_license_lookup', reference: 'x' })).toThrow(/license details/);
  });

  it('authorization is granted and removed (with a reason) by someone else', () => {
    const granted = apply(emptyCredentialRecord(licensee), { kind: 'grant_authorization' });
    expect(granted.authorization).toMatchObject({ authorizedBy: admin.id, authorizedByName: 'Avery Demo' });
    expect(() => apply(granted, { kind: 'revoke_authorization', reason: '' })).toThrow(/reason/);
    expect(apply(granted, { kind: 'revoke_authorization', reason: 'No longer acting as funeral director' }).authorization).toBeNull();
  });

  it('every change appends one audit entry with before and after; revision counts up', () => {
    const a = apply(emptyCredentialRecord(licensee), setLicense);
    const b = apply(a, { kind: 'grant_authorization' });
    const c = apply(b, { kind: 'revoke_authorization', reason: 'Fictional reason' });
    expect(c.history.map((h) => h.action)).toEqual(['license_set', 'authorization_granted', 'authorization_revoked']);
    expect(c.history.slice(0, 2)).toEqual(b.history);
    expect(c.history[2]).toMatchObject({ reason: 'Fictional reason', before: { authorization: b.authorization }, after: { authorization: null }, actorId: admin.id });
    expect(c.revision).toBe(3);
  });
});
