import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaxBundle } from '@/domain/faxBundles/faxBundle';

/**
 * The Wix side of fax bundle storage, against a stand-in for Wix Data that
 * behaves as Wix does where it matters: a second insert of the same id is
 * refused (HTTP 409), and a conditional patch whose condition is not met is
 * refused (HTTP 428, WDE0193) and changes nothing. No live Wix.
 */
const wix = vi.hoisted(() => {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  const of = (c: string) => (collections.has(c) ? collections.get(c)! : collections.set(c, new Map()).get(c)!);
  const matches = (row: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$eq' in (v as object)) return row[k] === (v as { $eq: unknown }).$eq;
      if (v && typeof v === 'object' && '$in' in (v as object)) return ((v as { $in: unknown[] }).$in).includes(row[k]);
      return row[k] === v;
    });
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  class WixDataApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return {
    calls,
    reset: () => (collections.clear(), (calls.length = 0)),
    rows: (c: string) => [...of(c).values()],
    api: {
      WixDataApiError,
      insertWixDataItem: async (c: string, data: Record<string, unknown>, id: string) => {
        calls.push({ fn: 'insert', args: [c, data, id] });
        if (of(c).has(id)) throw new WixDataApiError('duplicate', 409);
        of(c).set(id, structuredClone(data));
        return { id, data };
      },
      queryWixDataItems: async (c: string, query: { filter: Record<string, unknown>; paging?: { limit?: number } }) => {
        calls.push({ fn: 'query', args: [c, query] });
        const found = [...of(c).entries()].filter(([, row]) => matches(row, query.filter)).map(([id, data]) => ({ id, dataCollectionId: c, data: structuredClone(data) }));
        return { dataItems: query.paging?.limit ? found.slice(0, query.paging.limit) : found };
      },
      queryAllWixDataItems: async (c: string, filter: Record<string, unknown>) => {
        calls.push({ fn: 'queryAll', args: [c, filter] });
        return [...of(c).entries()].filter(([, row]) => matches(row, filter)).map(([id, data]) => ({ id, dataCollectionId: c, data: structuredClone(data) }));
      },
      conditionalPatchWixDataItemFields: async (c: string, id: string, fields: Record<string, unknown>, condition: { filter: Record<string, unknown> }) => {
        calls.push({ fn: 'patch', args: [c, id, fields, condition] });
        const row = of(c).get(id);
        if (!row) return { applied: false, status: 404 };
        if (!matches(row, condition.filter)) return { applied: false, status: 428 };
        of(c).set(id, { ...row, ...structuredClone(fields) });
        return { applied: true, dataItem: { id, data: of(c).get(id) } };
      },
      deleteWixDataItem: async (c: string, id: string) => {
        calls.push({ fn: 'delete', args: [c, id] });
        if (!of(c).delete(id)) throw new WixDataApiError('missing', 404);
      },
    },
  };
});
vi.mock('@/lib/wixDataApi', () => wix.api);

const store = await import('./faxBundleStore');

const ORG = 'managed-cremations';
const bundle = (overrides: Partial<FaxBundle> = {}): FaxBundle => ({
  id: store.newFaxBundleId(), organizationId: ORG, reference: 'DC-ABC234', purpose: 'manatee_dc_application', status: 'ready', revision: 0,
  items: [{ position: 1, caseId: 'case-1', caseNumber: 'B2026-901', documentId: 'doc-1', documentVersion: 1, documentChecksumSha256: 'a'.repeat(64), pageCount: 1, numbering: 'filled_blank' }],
  caseIds: ['case-1'], applicationCount: 1, pdfStorageKey: `${ORG}/fax-bundles/x.pdf`, pdfChecksumSha256: 'b'.repeat(64), pdfSizeBytes: 100, pdfPageCount: 1,
  destinationName: 'Manatee County Vital Statistics', destinationFaxNumber: '9415545490', destinationAddress: '9415545490@fax.nuso.io', gatewayDomain: 'fax.nuso.io',
  destinationId: null, providerKey: 'nuso', emailBody: '', settingsRevision: null,
  subject: 'Manors Cremation - DC Application Bundle DC-ABC234', senderAddress: null, createdBy: 'staff', createdAt: '2026-11-04T12:00:00.000Z', updatedAt: '2026-11-04T12:00:00.000Z',
  submissionId: null, sentBy: null, outlookContactedAt: null, submittedAt: null, outlookDraftId: null, internetMessageId: null, failureCode: null, failureMessage: null,
  confirmedBy: null, confirmedAt: null, deliveredAt: null, nusoReference: null, confirmationDocumentId: null, history: [], ...overrides,
});

beforeEach(() => wix.reset());

describe('faxBundles (Wix)', () => {
  it('stores the bundle under its own id and reads it back only for its organization', async () => {
    const b = bundle();
    expect(await store.insertFaxBundle(b, 'wix')).toBe('inserted');
    expect(wix.calls[0]).toMatchObject({ fn: 'insert', args: ['faxBundles', expect.objectContaining({ beaconFaxBundleId: b.id, organizationId: ORG, status: 'ready' }), b.id] });
    expect(await store.getFaxBundle(ORG, b.id, 'wix')).toEqual(b);
    expect(await store.getFaxBundle('evergreen-memorial-group', b.id, 'wix')).toBeNull();
    expect(await store.getFaxBundle(ORG, 'not-a-bundle-id', 'wix')).toBeNull();
    expect(await store.insertFaxBundle(b, 'wix')).toBe('exists');
  });

  it('every change is conditioned on organization, revision and status; a stale writer changes nothing', async () => {
    const b = bundle();
    await store.insertFaxBundle(b, 'wix');
    const sending = await store.updateFaxBundleIf(b, { status: 'sending', submissionId: 'sub-1' }, { actorId: 'staff', action: 'send_started', note: null }, 'wix');
    expect(sending).toMatchObject({ status: 'sending', revision: 1, history: [{ action: 'send_started', fromStatus: 'ready', toStatus: 'sending' }] });
    const patch = wix.calls.find((c) => c.fn === 'patch')!;
    expect(patch.args[3]).toEqual({ filter: { organizationId: { $eq: ORG }, revision: { $eq: 0 }, status: { $eq: 'ready' } } });
    // The same transition from the old revision (a second click) is refused.
    expect(await store.updateFaxBundleIf(b, { status: 'sending', submissionId: 'sub-2' }, { actorId: 'staff', action: 'send_started', note: null }, 'wix')).toBeNull();
    expect((await store.getFaxBundle(ORG, b.id, 'wix'))!.submissionId).toBe('sub-1');
  });

  it('a Wix failure other than "condition not met" is an error, never mistaken for a lost race', async () => {
    const b = bundle();
    await store.insertFaxBundle(b, 'wix');
    const original = wix.api.conditionalPatchWixDataItemFields;
    wix.api.conditionalPatchWixDataItemFields = async () => ({ applied: false, status: 500 });
    await expect(store.updateFaxBundleIf(b, { status: 'sending' }, { actorId: null, action: 'x', note: null }, 'wix')).rejects.toThrow(/HTTP 500/);
    wix.api.conditionalPatchWixDataItemFields = original;
  });
});

describe('faxBundleCases (Wix)', () => {
  it('a case can be held by only one bundle: Wix refuses the second claim; the holder is named', async () => {
    expect(await store.claimCaseForFaxBundle(ORG, 'case-1', 'fxb-a', 'wix')).toEqual({ claimed: true });
    expect(await store.claimCaseForFaxBundle(ORG, 'case-1', 'fxb-b', 'wix')).toEqual({ claimed: false, heldBy: 'fxb-a' });
    // The same bundle again (a retry) keeps its hold.
    expect(await store.claimCaseForFaxBundle(ORG, 'case-1', 'fxb-a', 'wix')).toEqual({ claimed: true });
    // Another organization's case with the same id is a different row.
    expect(await store.claimCaseForFaxBundle('evergreen-memorial-group', 'case-1', 'fxb-c', 'wix')).toEqual({ claimed: true });
  });

  it('two bundles claiming the same case at the same moment: exactly one wins', async () => {
    const results = await Promise.all([store.claimCaseForFaxBundle(ORG, 'case-9', 'fxb-a', 'wix'), store.claimCaseForFaxBundle(ORG, 'case-9', 'fxb-b', 'wix')]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
  });

  it('a hold is released only by the bundle that holds it', async () => {
    await store.claimCaseForFaxBundle(ORG, 'case-1', 'fxb-a', 'wix');
    await store.releaseFaxCaseClaim(ORG, 'case-1', 'fxb-b', 'wix');
    expect(await store.getFaxCaseClaim(ORG, 'case-1', 'wix')).toMatchObject({ bundleId: 'fxb-a' });
    await store.releaseFaxCaseClaim(ORG, 'case-1', 'fxb-a', 'wix');
    expect(await store.getFaxCaseClaim(ORG, 'case-1', 'wix')).toBeNull();
    // Releasing again is harmless.
    await expect(store.releaseFaxCaseClaim(ORG, 'case-1', 'fxb-a', 'wix')).resolves.toBeUndefined();
  });

  it('links are idempotent and list a case\'s bundles; ids stay within 128 characters', async () => {
    const b = bundle({ id: store.newFaxBundleId() });
    await store.linkCaseToFaxBundle(ORG, b, b.items[0], 'wix');
    await store.linkCaseToFaxBundle(ORG, b, b.items[0], 'wix');
    expect(wix.rows('faxBundleCases')).toHaveLength(1);
    expect(await store.listFaxBundleIdsForCase(ORG, 'case-1', 'wix')).toEqual([b.id]);
    expect(await store.listFaxBundleIdsForCase('evergreen-memorial-group', 'case-1', 'wix')).toEqual([]);
    const longCase = 'c'.repeat(300);
    for (const id of [store.faxClaimId(ORG, longCase), store.faxLinkId(ORG, b.id, longCase), b.id]) expect(id.length).toBeLessThanOrEqual(128);
  });
});
