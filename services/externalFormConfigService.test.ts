import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rows } = vi.hoisted(() => ({ rows: [] as Array<{ id: string; data: Record<string, unknown> }> }));

vi.mock('../lib/wixDataApi', async () => {
  const actual = await vi.importActual<typeof import('../lib/wixDataApi')>('../lib/wixDataApi');
  return {
    ...actual,
    queryWixDataItems: vi.fn(async (_collection: string, query: { filter?: Record<string, unknown>; paging?: { limit?: number } }) => ({
      dataItems: rows
        .filter((r) => Object.entries(query.filter ?? {}).every(([k, v]) => r.data[k] === v))
        .slice(0, query.paging?.limit ?? 50)
        .map((r) => ({ id: r.id, dataCollectionId: 'externalFormConfigs', data: r.data })),
    })),
  };
});

import { findByProviderFormId, resolveByProviderFormId, validateExternalFormConfigs } from './externalFormConfigService';
import { queryWixDataItems } from '../lib/wixDataApi';

function row(id: string, organizationId: string, externalFormId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      organizationId,
      provider: 'jotform',
      externalFormId,
      label: id,
      audience: 'staff',
      purpose: 'case_update',
      fieldMap: '{}',
      linkTokenFieldName: '',
      linkTokenFieldQid: '',
      webhookAuthFieldQid: '',
      isEnabled: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      ...extra,
    },
  };
}

beforeEach(() => {
  rows.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('validateExternalFormConfigs (pure)', () => {
  const base = { provider: 'jotform' };

  it('accepts distinct form ids across organizations', () => {
    expect(
      validateExternalFormConfigs([
        { ...base, id: 'a', organizationId: 'managed-cremations', externalFormId: '1' },
        { ...base, id: 'b', organizationId: 'gus-camacho-jr', externalFormId: '2' },
      ]),
    ).toEqual({ valid: true, issues: [] });
  });

  it('rejects the same form id in two organizations', () => {
    const result = validateExternalFormConfigs([
      { ...base, id: 'a', organizationId: 'managed-cremations', externalFormId: '1' },
      { ...base, id: 'b', organizationId: 'gus-camacho-jr', externalFormId: '1' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        code: 'duplicate_form_id_across_organizations',
        provider: 'jotform',
        externalFormId: '1',
        organizationIds: ['gus-camacho-jr', 'managed-cremations'],
        configIds: ['a', 'b'],
      },
    ]);
  });

  it('rejects the same form id twice within one organization', () => {
    const result = validateExternalFormConfigs([
      { ...base, id: 'a', organizationId: 'managed-cremations', externalFormId: '1' },
      { ...base, id: 'b', organizationId: 'managed-cremations', externalFormId: '1' },
    ]);
    expect(result.issues.map((i) => i.code)).toEqual(['duplicate_form_id_within_organization']);
  });

  it('the same numeric id under a different provider is not a duplicate', () => {
    expect(
      validateExternalFormConfigs([
        { ...base, id: 'a', organizationId: 'managed-cremations', externalFormId: '1' },
        { id: 'b', provider: 'other', organizationId: 'gus-camacho-jr', externalFormId: '1' },
      ]).valid,
    ).toBe(true);
  });

  it('rejects an apiKeyReference outside the JOTFORM_API_KEY family and an unknown mappingKey', () => {
    const result = validateExternalFormConfigs([
      { ...base, id: 'a', organizationId: 'gus-camacho-jr', externalFormId: '1', apiKeyReference: 'WIX_API_KEY' },
      { ...base, id: 'b', organizationId: 'gus-camacho-jr', externalFormId: '2', mappingKey: 'not-registered' },
      { ...base, id: 'c', organizationId: 'gus-camacho-jr', externalFormId: '3', apiKeyReference: 'JOTFORM_API_KEY_GUS_CAMACHO_JR' },
    ]);
    expect(result.issues.map((i) => [i.code, i.configIds[0]])).toEqual([
      ['invalid_api_key_reference', 'a'],
      ['unknown_mapping_key', 'b'],
    ]);
  });
});

describe('resolveByProviderFormId (wix)', () => {
  it('reads every enabled row — never limit 1 — and resolves exactly one', async () => {
    rows.push(row('cfg-m', 'managed-cremations', '111'), row('cfg-g', 'gus-camacho-jr', '222'));
    const resolution = await resolveByProviderFormId('jotform', '222', 'wix');
    expect(resolution.status).toBe('resolved');
    expect(resolution.status === 'resolved' && resolution.config.organizationId).toBe('gus-camacho-jr');
    const [, query] = vi.mocked(queryWixDataItems).mock.calls[0];
    expect(query.paging?.limit).toBeGreaterThan(1);
    expect(query.filter).toEqual({ provider: 'jotform', externalFormId: '222', isEnabled: true });
  });

  it('returns not_found for an unknown form', async () => {
    expect(await resolveByProviderFormId('jotform', '999', 'wix')).toEqual({ status: 'not_found' });
  });

  it('a form id claimed by two organizations is ambiguous — regardless of row order — and findByProviderFormId returns null', async () => {
    rows.push(row('cfg-m', 'managed-cremations', '111'), row('cfg-g', 'gus-camacho-jr', '111'));
    const resolution = await resolveByProviderFormId('jotform', '111', 'wix');
    expect(resolution.status).toBe('ambiguous');
    expect(await findByProviderFormId('jotform', '111', 'wix')).toBeNull();
    rows.reverse();
    expect((await resolveByProviderFormId('jotform', '111', 'wix')).status).toBe('ambiguous');
  });

  it('an enabled row that does not even map still counts as a competing claimant', async () => {
    rows.push(row('cfg-m', 'managed-cremations', '111'), { id: 'broken', data: { provider: 'jotform', externalFormId: '111', isEnabled: true } });
    expect((await resolveByProviderFormId('jotform', '111', 'wix')).status).toBe('ambiguous');
  });

  it('a single invalid row is never resolved', async () => {
    rows.push(row('cfg-g', 'gus-camacho-jr', '222', { apiKeyReference: 'SESSION_SECRET' }));
    expect((await resolveByProviderFormId('jotform', '222', 'wix')).status).toBe('invalid');
  });

  it('reads mappingKey/apiKeyReference from the stored row', async () => {
    rows.push(row('cfg-g', 'gus-camacho-jr', '222', { apiKeyReference: 'JOTFORM_API_KEY_GUS_CAMACHO_JR' }));
    const resolved = await findByProviderFormId('jotform', '222', 'wix');
    expect(resolved?.apiKeyReference).toBe('JOTFORM_API_KEY_GUS_CAMACHO_JR');
  });
});

describe('resolveByProviderFormId (mock fixtures) — Manors unchanged', () => {
  it('still resolves each real Manors form to Manors', async () => {
    for (const formId of ['262605621454050', '261945978664175', '262664842044055']) {
      const config = await findByProviderFormId('jotform', formId, 'mock');
      expect(config?.organizationId).toBe('managed-cremations');
    }
  });
});
