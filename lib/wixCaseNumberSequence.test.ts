import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.WIX_API_KEY = 'test-key';
  process.env.WIX_SITE_ID = 'test-site';
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  vi.unstubAllGlobals();
});

/**
 * Drives lib/wixCaseNumberSequence.ts through a real global-fetch stub
 * (rather than mocking lib/wixDataApi.ts's individual functions) so the
 * actual HTTP method/URL/status-code branching this module depends on is
 * genuinely exercised, matching how its correctness was originally
 * verified empirically against the live Wix project (see the module's own
 * comment and docs/adr/ADR-018-case-number-generation.md).
 */
function stubFetchSequence(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const { status, body } = handler(url, init);
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    }),
  );
}

const {
  reserveNextCaseNumber,
  getCaseSequenceState,
  initializeCaseSequence,
  advanceCaseSequencePast,
  CaseSequenceAlreadyInitializedError,
} = await import('./wixCaseNumberSequence');

describe('reserveNextCaseNumber — row already exists (the common path)', () => {
  it('atomically increments and returns the pre-increment value as the assigned number', async () => {
    stubFetchSequence((url, init) => {
      expect(init.method).toBe('PATCH');
      expect(url).toBe('https://www.wixapis.com/wix-data/v2/items/managed-cremations-2026');
      return {
        status: 200,
        body: { dataItem: { id: 'managed-cremations-2026', dataCollectionId: 'caseSequences', data: { nextSequence: 58 } } },
      };
    });

    const result = await reserveNextCaseNumber('managed-cremations', 2026);
    expect(result).toBe('B2026-057'); // assigned = post-increment (58) - 1
  });
});

describe('reserveNextCaseNumber — bootstrap (first case of the year for this organization)', () => {
  it('creates the sequence row claiming sequence 1 when the increment 404s', async () => {
    let call = 0;
    stubFetchSequence((url, init) => {
      call += 1;
      if (call === 1) {
        expect(init.method).toBe('PATCH');
        return { status: 404, body: {} };
      }
      expect(init.method).toBe('POST');
      expect(url).toBe('https://www.wixapis.com/wix-data/v2/items');
      const parsed = JSON.parse(init.body as string);
      expect(parsed.dataItem.id).toBe('managed-cremations-2026');
      expect(parsed.dataItem.data.nextSequence).toBe(2); // leaves 2 for the next claimant
      return { status: 200, body: { dataItem: { id: 'managed-cremations-2026', dataCollectionId: 'caseSequences', data: parsed.dataItem.data } } };
    });

    const result = await reserveNextCaseNumber('managed-cremations', 2026);
    expect(result).toBe('B2026-001');
    expect(call).toBe(2);
  });

  it('falls back to the atomic increment when the insert loses a creation race (409)', async () => {
    let call = 0;
    stubFetchSequence((url, init) => {
      call += 1;
      if (call === 1) {
        expect(init.method).toBe('PATCH');
        return { status: 404, body: {} }; // row doesn't exist yet
      }
      if (call === 2) {
        expect(init.method).toBe('POST');
        return { status: 409, body: {} }; // another request created it first
      }
      expect(init.method).toBe('PATCH'); // retry now that the row exists
      return {
        status: 200,
        body: { dataItem: { id: 'managed-cremations-2026', dataCollectionId: 'caseSequences', data: { nextSequence: 3 } } },
      };
    });

    const result = await reserveNextCaseNumber('managed-cremations', 2026);
    expect(result).toBe('B2026-002'); // assigned = post-increment (3) - 1
    expect(call).toBe(3);
  });
});

describe('reserveNextCaseNumber — genuine failures are not swallowed', () => {
  it('rethrows a non-404 increment failure instead of treating it as a bootstrap case', async () => {
    stubFetchSequence(() => ({ status: 503, body: {} }));
    await expect(reserveNextCaseNumber('managed-cremations', 2026)).rejects.toThrow(/HTTP 503/);
  });

  it('rethrows a non-409 insert failure instead of treating it as a lost creation race', async () => {
    let call = 0;
    stubFetchSequence(() => {
      call += 1;
      if (call === 1) return { status: 404, body: {} };
      return { status: 500, body: {} };
    });
    await expect(reserveNextCaseNumber('managed-cremations', 2026)).rejects.toThrow(/HTTP 500/);
  });
});

describe('reserveNextCaseNumber — per-organization, per-year isolation', () => {
  it('uses a sequence row scoped by both organizationId and year', async () => {
    stubFetchSequence((url) => {
      expect(url).toBe('https://www.wixapis.com/wix-data/v2/items/evergreen-memorial-group-2027');
      return { status: 200, body: { dataItem: { id: 'x', dataCollectionId: 'caseSequences', data: { nextSequence: 2 } } } };
    });

    const result = await reserveNextCaseNumber('evergreen-memorial-group', 2027);
    expect(result).toBe('B2027-001');
  });
});

describe('getCaseSequenceState (Manors launch-prep — P0 automatic case numbering)', () => {
  it('returns null when no row exists for this organization+year yet', async () => {
    stubFetchSequence((url, init) => {
      expect(init.method).toBe('POST');
      expect(url).toBe('https://www.wixapis.com/wix-data/v2/items/query');
      return { status: 200, body: { dataItems: [] } };
    });
    expect(await getCaseSequenceState('managed-cremations', 2026)).toBeNull();
  });

  it('returns the current nextSequence when a row exists', async () => {
    stubFetchSequence(() => ({
      status: 200,
      body: { dataItems: [{ id: 'managed-cremations-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'managed-cremations', year: 2026, nextSequence: 185 } }] },
    }));
    expect(await getCaseSequenceState('managed-cremations', 2026)).toEqual({ nextSequence: 185 });
  });
});

describe('initializeCaseSequence (Manors launch-prep — P0 automatic case numbering)', () => {
  it('creates a fresh row with the requested starting number when none exists yet', async () => {
    stubFetchSequence((url, init) => {
      expect(init.method).toBe('POST');
      expect(url).toBe('https://www.wixapis.com/wix-data/v2/items');
      const parsed = JSON.parse(init.body as string);
      expect(parsed.dataItem.id).toBe('manors-2026');
      expect(parsed.dataItem.data).toEqual({ organizationId: 'manors', year: 2026, nextSequence: 185 });
      return { status: 200, body: { dataItem: { id: 'manors-2026', dataCollectionId: 'caseSequences', data: parsed.dataItem.data } } };
    });

    const result = await initializeCaseSequence('manors', 2026, 185);
    expect(result).toEqual({ nextSequence: 185 });
  });

  it('refuses to silently overwrite an already-initialized row without forceOverwrite', async () => {
    let call = 0;
    stubFetchSequence((url, init) => {
      call += 1;
      if (call === 1) {
        expect(init.method).toBe('POST');
        expect(url).toBe('https://www.wixapis.com/wix-data/v2/items');
        return { status: 409, body: {} }; // row already exists
      }
      expect(init.method).toBe('POST');
      expect(url).toBe('https://www.wixapis.com/wix-data/v2/items/query');
      return { status: 200, body: { dataItems: [{ id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: 17 } }] } };
    });

    await expect(initializeCaseSequence('manors', 2026, 185)).rejects.toBeInstanceOf(CaseSequenceAlreadyInitializedError);
  });

  it('exposes the currently-issued nextSequence on the thrown error', async () => {
    stubFetchSequence((url) => {
      if (url === 'https://www.wixapis.com/wix-data/v2/items') return { status: 409, body: {} };
      return { status: 200, body: { dataItems: [{ id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: 17 } }] } };
    });

    await expect(initializeCaseSequence('manors', 2026, 185)).rejects.toMatchObject({ currentNextSequence: 17 });
  });

  it('allows forceOverwrite to move the sequence forward — the real "reset dev residue to the real production number" case', async () => {
    let call = 0;
    stubFetchSequence((url, init) => {
      call += 1;
      if (call === 1) return { status: 409, body: {} }; // row already exists
      if (call === 2) {
        expect(url).toBe('https://www.wixapis.com/wix-data/v2/items/query');
        return { status: 200, body: { dataItems: [{ id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: 17 } }] } };
      }
      expect(init.method).toBe('PUT');
      expect(url).toBe('https://www.wixapis.com/wix-data/v2/items/manors-2026?dataCollectionId=caseSequences');
      const parsed = JSON.parse(init.body as string);
      expect(parsed.dataItem.data).toEqual({ organizationId: 'manors', year: 2026, nextSequence: 185 });
      return { status: 200, body: { dataItem: { id: 'manors-2026', dataCollectionId: 'caseSequences', data: parsed.dataItem.data } } };
    });

    const result = await initializeCaseSequence('manors', 2026, 185, { forceOverwrite: true });
    expect(result).toEqual({ nextSequence: 185 });
  });

  it('refuses forceOverwrite when the requested number would move the sequence BACKWARDS (would allow reuse)', async () => {
    stubFetchSequence((url) => {
      if (url === 'https://www.wixapis.com/wix-data/v2/items') return { status: 409, body: {} };
      return { status: 200, body: { dataItems: [{ id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: 188 } }] } };
    });

    await expect(initializeCaseSequence('manors', 2026, 5, { forceOverwrite: true })).rejects.toThrow(/backwards/);
  });

  it('allows forceOverwrite to set the exact same value as a no-op', async () => {
    let call = 0;
    stubFetchSequence(() => {
      call += 1;
      if (call === 1) return { status: 409, body: {} };
      if (call === 2) return { status: 200, body: { dataItems: [{ id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: 185 } }] } };
      return { status: 200, body: { dataItem: { id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: 185 } } } };
    });

    const result = await initializeCaseSequence('manors', 2026, 185, { forceOverwrite: true });
    expect(result).toEqual({ nextSequence: 185 });
  });
});

describe('reserveNextCaseNumber — no reuse after a case is later deleted/cancelled (Manors launch-prep — P0)', () => {
  it('never hands out a number again just because the case that held it is gone — the counter only ever increments forward', async () => {
    // Mirrors the exact P0 scenario: B2026-185, B2026-186, B2026-187 are
    // issued; the case holding B2026-186 is later deleted/cancelled
    // (Solis is soft-delete-only and has no action that could ever touch
    // caseSequences on deletion in the first place — this is structural,
    // not merely tested — see docs/adr/ADR-018-case-number-generation.md's
    // "Deletion / never-reused guarantee"). The 4th reservation, made after
    // that deletion, must be B2026-188, never a re-issued B2026-186.
    let nextSequence = 185;
    stubFetchSequence((url, init) => {
      expect(init.method).toBe('PATCH');
      const assigned = nextSequence;
      nextSequence += 1;
      return { status: 200, body: { dataItem: { id: 'manors-2026', dataCollectionId: 'caseSequences', data: { nextSequence: assigned + 1 } } } };
    });

    expect(await reserveNextCaseNumber('manors', 2026)).toBe('B2026-185');
    expect(await reserveNextCaseNumber('manors', 2026)).toBe('B2026-186');
    expect(await reserveNextCaseNumber('manors', 2026)).toBe('B2026-187');
    // B2026-186's case is deleted/cancelled here — no code path exists that
    // could feed that fact back into this function; nothing to simulate.
    expect(await reserveNextCaseNumber('manors', 2026)).toBe('B2026-188');
  });
});

/**
 * Historical-import sequence safety (2026-10). The exact live defect this
 * function exists to prevent: the historical Jotform import preserves the
 * number carried on the submission and never calls
 * `reserveNextCaseNumber`, so importing B2026-036 while `nextSequence`
 * was 36 left the counter BEHIND reality — the next normally-allocated
 * case would have been handed B2026-036 a second time.
 */
describe('advanceCaseSequencePast', () => {
  it('advances a counter that has fallen behind an imported number to imported + 1', async () => {
    // The real Manors state: nextSequence 36, B2026-036 just imported.
    let call = 0;
    stubFetchSequence((url, init) => {
      call += 1;
      if (call === 1) {
        expect(url).toBe('https://www.wixapis.com/wix-data/v2/items/query');
        return { status: 200, body: { dataItems: [{ id: 'managed-cremations-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'managed-cremations', year: 2026, nextSequence: 36 } }] } };
      }
      if (call === 2) return { status: 409, body: {} }; // initializeCaseSequence's insert — row exists
      if (call === 3) return { status: 200, body: { dataItems: [{ id: 'managed-cremations-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'managed-cremations', year: 2026, nextSequence: 36 } }] } };
      expect(init.method).toBe('PUT');
      const parsed = JSON.parse(init.body as string);
      expect(parsed.dataItem.data.nextSequence).toBe(37);
      return { status: 200, body: { dataItem: { id: 'managed-cremations-2026', dataCollectionId: 'caseSequences', data: parsed.dataItem.data } } };
    });

    const result = await advanceCaseSequencePast('managed-cremations', 2026, 36);
    expect(result).toEqual({ nextSequence: 37, advanced: true });
  });

  it('leaves a counter that is already ahead completely untouched (no write at all)', async () => {
    // Importing an OLD number (B2026-012) when the counter is already at
    // 40 must never drag it backwards — and must not write anything.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ dataItems: [{ id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: 40 } }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await advanceCaseSequencePast('manors', 2026, 12);
    expect(result).toEqual({ nextSequence: 40, advanced: false });
    // Exactly one call: the read. No insert, no PUT.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the counter already sits exactly one past the imported number', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ dataItems: [{ id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: 37 } }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await advanceCaseSequencePast('manors', 2026, 36);
    expect(result).toEqual({ nextSequence: 37, advanced: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — running it twice on the same import does not advance twice', async () => {
    let stored = 36;
    stubFetchSequence((url, init) => {
      if (url === 'https://www.wixapis.com/wix-data/v2/items/query') {
        return { status: 200, body: { dataItems: [{ id: 'manors-2026', dataCollectionId: 'caseSequences', data: { organizationId: 'manors', year: 2026, nextSequence: stored } }] } };
      }
      if (url === 'https://www.wixapis.com/wix-data/v2/items') return { status: 409, body: {} };
      const parsed = JSON.parse(init.body as string);
      stored = parsed.dataItem.data.nextSequence;
      return { status: 200, body: { dataItem: { id: 'manors-2026', dataCollectionId: 'caseSequences', data: parsed.dataItem.data } } };
    });

    expect(await advanceCaseSequencePast('manors', 2026, 36)).toEqual({ nextSequence: 37, advanced: true });
    expect(await advanceCaseSequencePast('manors', 2026, 36)).toEqual({ nextSequence: 37, advanced: false });
    expect(stored).toBe(37);
  });

  it('creates the row when no sequence exists yet, so a later case cannot collide with the imported number', async () => {
    let call = 0;
    stubFetchSequence((url, init) => {
      call += 1;
      if (call === 1) return { status: 200, body: { dataItems: [] } }; // no row yet
      expect(url).toBe('https://www.wixapis.com/wix-data/v2/items');
      expect(init.method).toBe('POST');
      const parsed = JSON.parse(init.body as string);
      expect(parsed.dataItem.data).toEqual({ organizationId: 'fresh-org', year: 2026, nextSequence: 37 });
      return { status: 200, body: { dataItem: { id: 'fresh-org-2026', dataCollectionId: 'caseSequences', data: parsed.dataItem.data } } };
    });

    const result = await advanceCaseSequencePast('fresh-org', 2026, 36);
    expect(result).toEqual({ nextSequence: 37, advanced: true });
  });

  it('keeps years independent — advancing 2026 never touches the 2025 row', async () => {
    const seen: string[] = [];
    stubFetchSequence((url, init) => {
      if (url === 'https://www.wixapis.com/wix-data/v2/items/query') {
        const parsed = JSON.parse(init.body as string);
        seen.push(`query:${parsed.query.filter.year}`);
        return { status: 200, body: { dataItems: [] } };
      }
      const parsed = JSON.parse(init.body as string);
      seen.push(`insert:${parsed.dataItem.id}`);
      return { status: 200, body: { dataItem: { id: parsed.dataItem.id, dataCollectionId: 'caseSequences', data: parsed.dataItem.data } } };
    });

    await advanceCaseSequencePast('manors', 2026, 36);
    expect(seen).toEqual(['query:2026', 'insert:manors-2026']);
  });
});

/**
 * Organization-specific case numbering (2026-10). Manors
 * (`managed-cremations`, prefix B) and Gus Camacho (`gus-camacho-jr`,
 * prefix M) share one multi-tenant backend, so their sequences must be
 * fully independent per organization AND per year. Driven through an
 * in-memory fake of the two Wix operations reserveNextCaseNumber relies
 * on (atomic INCREMENT_FIELD PATCH, `_id`-unique INSERT), so concurrent
 * interleavings genuinely exercise the 404 -> insert -> 409 -> retry paths.
 */
describe('reserveNextCaseNumber — two organizations, independent sequences', () => {
  function stubInMemoryCaseSequences(seed: Record<string, number> = {}) {
    const rows = new Map<string, number>(Object.entries(seed));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        // Yield first so concurrent callers genuinely interleave.
        await Promise.resolve();
        const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
        if (init.method === 'PATCH') {
          const id = decodeURIComponent(url.split('/items/')[1]);
          if (!rows.has(id)) return reply(404, {});
          rows.set(id, (rows.get(id) as number) + 1);
          return reply(200, { dataItem: { id, dataCollectionId: 'caseSequences', data: { nextSequence: rows.get(id) } } });
        }
        if (init.method === 'POST' && url.endsWith('/items')) {
          const parsed = JSON.parse(init.body as string);
          const id = parsed.dataItem.id as string;
          if (rows.has(id)) return reply(409, {});
          rows.set(id, parsed.dataItem.data.nextSequence);
          return reply(200, { dataItem: { id, dataCollectionId: 'caseSequences', data: parsed.dataItem.data } });
        }
        return reply(500, {});
      }),
    );
    return rows;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('concurrent creation in two organizations yields independent, gap-free, duplicate-free sequences with each org prefix', async () => {
    const rows = stubInMemoryCaseSequences();
    const reservations = await Promise.all([
      ...Array.from({ length: 5 }, () => reserveNextCaseNumber('managed-cremations', 2026, 'B')),
      ...Array.from({ length: 5 }, () => reserveNextCaseNumber('gus-camacho-jr', 2026, 'M')),
    ]);
    const manors = reservations.filter((n) => n.startsWith('B')).sort();
    const gus = reservations.filter((n) => n.startsWith('M')).sort();
    expect(manors).toEqual(['B2026-001', 'B2026-002', 'B2026-003', 'B2026-004', 'B2026-005']);
    expect(gus).toEqual(['M2026-001', 'M2026-002', 'M2026-003', 'M2026-004', 'M2026-005']);
    expect(new Set(reservations).size).toBe(10);
    expect(rows.get('managed-cremations-2026')).toBe(6);
    expect(rows.get('gus-camacho-jr-2026')).toBe(6);
  });

  it("a new organization's first case never touches or resets an existing organization's sequence", async () => {
    const rows = stubInMemoryCaseSequences({ 'managed-cremations-2026': 58 });
    expect(await reserveNextCaseNumber('gus-camacho-jr', 2026, 'M')).toBe('M2026-001');
    expect(await reserveNextCaseNumber('gus-camacho-jr', 2026, 'M')).toBe('M2026-002');
    expect(rows.get('managed-cremations-2026')).toBe(58);
    // Manors' next number continues exactly where it was.
    expect(await reserveNextCaseNumber('managed-cremations', 2026, 'B')).toBe('B2026-058');
  });

  it('year rollover (Dec 31 -> Jan 1, org-local) restarts at 001 for each organization with the right year', async () => {
    const { orgLocalYear } = await import('../domain/cases/caseNumber');
    stubInMemoryCaseSequences({ 'managed-cremations-2026': 120, 'gus-camacho-jr-2026': 40 });
    vi.useFakeTimers({ toFake: ['Date'] });

    // 23:59 on Dec 31 in America/New_York (UTC-5): still the old year.
    vi.setSystemTime(new Date('2027-01-01T04:59:00.000Z'));
    const lateYear = orgLocalYear(new Date().toISOString(), 'America/New_York');
    expect(await reserveNextCaseNumber('managed-cremations', lateYear, 'B')).toBe(`B${lateYear}-120`);
    expect(await reserveNextCaseNumber('gus-camacho-jr', lateYear, 'M')).toBe(`M${lateYear}-040`);

    // 00:01 on Jan 1 local: a new year, each organization restarts at 001.
    vi.setSystemTime(new Date('2027-01-01T05:01:00.000Z'));
    const newYear = orgLocalYear(new Date().toISOString(), 'America/New_York');
    expect(newYear).toBe(lateYear + 1);
    expect(await reserveNextCaseNumber('gus-camacho-jr', newYear, 'M')).toBe(`M${newYear}-001`);
    expect(await reserveNextCaseNumber('managed-cremations', newYear, 'B')).toBe(`B${newYear}-001`);
    expect(await reserveNextCaseNumber('gus-camacho-jr', newYear, 'M')).toBe(`M${newYear}-002`);
  });
});

describe('reserveNextCaseNumber — invalid prefix/year fail before consuming a number', () => {
  it('rejects an invalid explicit prefix without calling Wix', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(reserveNextCaseNumber('gus-camacho-jr', 2026, 'M1')).rejects.toThrow(/Invalid case-number prefix/);
    await expect(reserveNextCaseNumber('gus-camacho-jr', 2026, 'ABCD')).rejects.toThrow(/Invalid case-number prefix/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-4-digit year without calling Wix', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(reserveNextCaseNumber('gus-camacho-jr', 26, 'M')).rejects.toThrow(/Invalid case-number year/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
