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

const { reserveNextCaseNumber } = await import('./wixCaseNumberSequence');

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
