import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listTokensForStaffProfile, generateFeedToken, revokeFeedToken, resolveFeedToken, touchFeedTokenAccess, CalendarFeedTokenServiceError } from './calendarFeedTokenService';
import { calendarFeedTokenFixtures } from './__mocks__/calendarFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `feed-token-${idCounter}`;
}

beforeEach(() => {
  idCounter = 0;
  calendarFeedTokenFixtures.length = 0;
});
afterEach(() => {
  calendarFeedTokenFixtures.length = 0;
});

describe('generateFeedToken', () => {
  it('returns a raw token distinct from the persisted hash, and persists no plaintext token anywhere', async () => {
    const { token, rawToken } = await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    expect(rawToken).toHaveLength(64); // 32 bytes, hex-encoded
    expect(token.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(calendarFeedTokenFixtures)).not.toContain(rawToken);
  });

  it('never revokes a pre-existing token for the same StaffProfile', async () => {
    const first = await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    const persisted = calendarFeedTokenFixtures.find((t) => t.id === first.token.id)!;
    expect(persisted.revokedAt).toBeNull();
  });
});

describe('listTokensForStaffProfile', () => {
  it('scopes strictly to (organizationId, staffProfileId)', async () => {
    await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-chris', idFactory, 'mock');
    const tokens = await listTokensForStaffProfile(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'mock');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].ownerStaffProfileId).toBe('staff-dana');
  });
});

describe('revokeFeedToken', () => {
  it('sets revokedAt and throws for a nonexistent token', async () => {
    const { token } = await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    const revoked = await revokeFeedToken(DEFAULT_ORGANIZATION_ID, token.id, 'mock');
    expect(revoked.revokedAt).not.toBeNull();

    await expect(revokeFeedToken(DEFAULT_ORGANIZATION_ID, 'does-not-exist', 'mock')).rejects.toThrow(CalendarFeedTokenServiceError);
  });
});

describe('resolveFeedToken', () => {
  it('resolves a valid, active token by its raw value', async () => {
    const { rawToken } = await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    const resolved = await resolveFeedToken(rawToken, 'mock');
    expect(resolved?.ownerStaffProfileId).toBe('staff-dana');
  });

  it('returns null for a nonexistent or malformed token', async () => {
    expect(await resolveFeedToken('not-a-real-token', 'mock')).toBeNull();
  });

  it('returns null for a revoked token, identically to a nonexistent one', async () => {
    const { token, rawToken } = await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    await revokeFeedToken(DEFAULT_ORGANIZATION_ID, token.id, 'mock');
    expect(await resolveFeedToken(rawToken, 'mock')).toBeNull();
  });
});

describe('touchFeedTokenAccess', () => {
  it('updates lastAccessedAt', async () => {
    const { token } = await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock');
    expect(token.lastAccessedAt).toBeNull();
    await touchFeedTokenAccess(token, 'mock');
    const persisted = calendarFeedTokenFixtures.find((t) => t.id === token.id)!;
    expect(persisted.lastAccessedAt).not.toBeNull();
  });

  it('never throws even if the underlying patch fails (best-effort)', async () => {
    const fakeToken = { ...(await generateFeedToken(DEFAULT_ORGANIZATION_ID, 'staff-dana', idFactory, 'mock')).token, id: 'nonexistent-id' };
    await expect(touchFeedTokenAccess(fakeToken, 'mock')).resolves.toBeUndefined();
  });
});
