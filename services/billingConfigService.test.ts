import { afterEach, describe, expect, it } from 'vitest';
import { getSupplementalConfig, updateSupplementalConfig } from './billingConfigService';
import { billingSupplementalConfigFixtures } from './__mocks__/billingFixtures';

let n = 0;
const idFactory = () => `sup-${(n += 1)}`;
const ORG = 'org-1';

afterEach(() => {
  billingSupplementalConfigFixtures.length = 0;
  n = 0;
});

describe('billingConfigService', () => {
  it('a missing config resolves to an empty version-0 config (never eagerly seeded)', async () => {
    const config = await getSupplementalConfig(ORG, 'mock');
    expect(config.version).toBe(0);
    expect(config.blocks).toEqual([]);
    expect(billingSupplementalConfigFixtures).toHaveLength(0);
  });

  it('appends a new version on each edit and returns the latest', async () => {
    await updateSupplementalConfig({ organizationId: ORG, blocks: [{ key: 'note', document: 'general_price_list', text: 'We are family owned.' }], idFactory }, 'mock');
    const v2 = await updateSupplementalConfig(
      { organizationId: ORG, blocks: [{ key: 'note', document: 'general_price_list', text: 'Updated note.' }], idFactory },
      'mock',
    );
    expect(v2.version).toBe(2);
    const current = await getSupplementalConfig(ORG, 'mock');
    expect(current.version).toBe(2);
    expect(current.blocks[0].text).toBe('Updated note.');
    expect(billingSupplementalConfigFixtures).toHaveLength(2); // history preserved
  });

  it('only stores optional block fields (key/document/text) — no mandatory-text path', async () => {
    const cfg = await updateSupplementalConfig(
      { organizationId: ORG, blocks: [{ key: 'x', document: 'statement_of_goods_and_services', text: 'Optional.' }], idFactory },
      'mock',
    );
    expect(Object.keys(cfg.blocks[0]).sort()).toEqual(['document', 'key', 'text']);
  });
});
