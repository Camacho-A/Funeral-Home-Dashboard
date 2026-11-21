import { describe, expect, it, vi } from 'vitest';

/** Live-path shape of the claim (Phase 5P): a fixed `_id`, and Wix's 409 on a duplicate `_id` means "already used". */
const inserted: Array<{ collection: string; id?: string; data: Record<string, unknown> }> = [];
vi.mock('../lib/wixDataApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/wixDataApi')>();
  return {
    ...actual,
    insertWixDataItem: vi.fn(async (collection: string, data: Record<string, unknown>, id?: string) => {
      if (inserted.some((i) => i.collection === collection && i.id === id)) throw new actual.WixDataApiError('duplicate', 409);
      inserted.push({ collection, id, data });
      return { id, data };
    }),
  };
});
const { claimSetupGrant, redemptionId } = await import('./portalMfaStore');

describe('setup grant claim on Wix', () => {
  it('writes one claim row with a fixed id into portalMfaSetupGrants; a second claim gets 409 and returns false', async () => {
    const grant = { kind: 'grant' as const, id: 'grant-1', scopeId: 'portal-x', identityId: 'identity-x', codeHash: 'h', organizationId: 'gus-camacho-jr', grantedBy: 'a', grantedAt: 't', expiresAt: 't', usedAt: null, revokedAt: null };
    expect(await claimSetupGrant(grant, '2026-11-20T00:00:00.000Z', 'wix')).toBe(true);
    expect(await claimSetupGrant(grant, '2026-11-20T00:00:01.000Z', 'wix')).toBe(false);
    expect(inserted).toEqual([{ collection: 'portalMfaSetupGrants', id: redemptionId('grant-1'), data: expect.objectContaining({ kind: 'redemption', grantId: 'grant-1' }) }]);
    expect(Object.keys(inserted[0].data)).not.toContain('codeHash');
  });
});
