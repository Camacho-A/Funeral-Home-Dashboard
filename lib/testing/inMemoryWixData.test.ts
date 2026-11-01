import { describe, expect, it } from 'vitest';
import { createInMemoryWixData } from './inMemoryWixData';

/**
 * Case concurrency (2026-10). The stand-in's own contract — the parts of
 * the Wix PatchDataItem / UpdateDataItem reference (and the live-verified
 * behaviour) the case write tests rely on. See docs/CASE_CONCURRENCY.md.
 */
describe('in-memory Wix Data stand-in — documented contract', () => {
  it('PatchDataItem changes only the listed fields; an unmet condition is HTTP 428 and writes nothing', async () => {
    const wix = createInMemoryWixData();
    wix.seed('things', 't1', { a: 1, b: 'x', revision: 3 });
    expect(await wix.api.conditionalPatchWixDataItemFields('things', 't1', { a: 2, revision: 4 }, { filter: { revision: { $eq: 3 } } })).toMatchObject({ applied: true });
    expect(wix.get('things', 't1')).toEqual({ a: 2, b: 'x', revision: 4 });
    expect(await wix.api.conditionalPatchWixDataItemFields('things', 't1', { a: 9, revision: 4 }, { filter: { revision: { $eq: 3 } } })).toEqual({ applied: false, status: 428 });
    expect(wix.get('things', 't1')).toEqual({ a: 2, b: 'x', revision: 4 });
    expect(wix.conditions).toHaveLength(2);
  });

  it('`$eq: null` matches an absent field (live-verified); `$isEmpty` in a condition is HTTP 400 (WDE0076), never "not met"', async () => {
    const wix = createInMemoryWixData();
    wix.seed('things', 't1', { a: 1 });
    expect(await wix.api.conditionalPatchWixDataItemFields('things', 't1', { a: 2 }, { filter: { revision: { $isEmpty: true } } })).toEqual({ applied: false, status: 400 });
    expect(await wix.api.conditionalPatchWixDataItemFields('things', 't1', { revision: 1 }, { filter: { revision: { $eq: null } } })).toMatchObject({ applied: true });
  });

  it('1–100 field modifications per patch (documented minItems/maxItems), else HTTP 400; a missing item is 404', async () => {
    const wix = createInMemoryWixData();
    wix.seed('things', 't1', {});
    expect(await wix.api.conditionalPatchWixDataItemFields('things', 't1', {}, { filter: {} })).toEqual({ applied: false, status: 400 });
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`f${i}`, i]));
    expect(await wix.api.conditionalPatchWixDataItemFields('things', 't1', many, { filter: {} })).toEqual({ applied: false, status: 400 });
    expect(await wix.api.conditionalPatchWixDataItemFields('things', 'missing', { a: 1 }, { filter: {} })).toEqual({ applied: false, status: 404 });
  });

  it('with systemFields, every write refreshes `_updatedDate` (documented) and keeps `_createdDate`', async () => {
    let clock = 0;
    const wix = createInMemoryWixData({ systemFields: true, now: () => `2026-10-15T00:00:0${clock++}.000Z` });
    await wix.api.insertWixDataItem('things', { a: 1 }, 't1');
    const created = wix.get('things', 't1')!;
    await wix.api.conditionalPatchWixDataItemFields('things', 't1', { a: 2 }, { filter: {} });
    const patched = wix.get('things', 't1')!;
    expect(patched._createdDate).toBe(created._createdDate);
    expect(patched._updatedDate).not.toBe(created._updatedDate);
    await wix.api.updateWixDataItem('things', 't1', { a: 3 });
    expect(wix.get('things', 't1')).toMatchObject({ a: 3, _createdDate: created._createdDate });
  });

  it('two concurrent conditional patches from the same revision: exactly one applies (the live-verified single-winner property)', async () => {
    const wix = createInMemoryWixData();
    wix.seed('things', 't1', { owner: null });
    const results = await Promise.all([
      wix.api.conditionalPatchWixDataItemFields('things', 't1', { owner: 'A', revision: 1 }, { filter: { revision: { $eq: null } } }),
      wix.api.conditionalPatchWixDataItemFields('things', 't1', { owner: 'B', revision: 1 }, { filter: { revision: { $eq: null } } }),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.filter((r) => !r.applied)).toEqual([{ applied: false, status: 428 }]);
  });
});
