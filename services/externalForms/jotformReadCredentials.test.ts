import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalFormConfig } from '@/types/externalFormConfig';

/**
 * JotForm credential isolation (2026-11). Fictional form ids and env var
 * NAMES only — no key value is ever involved.
 */
const rows = vi.hoisted(() => [] as ExternalFormConfig[]);
vi.mock('../externalFormConfigService', () => ({
  listForOrganization: vi.fn(async (organizationId: string) => rows.filter((r) => r.organizationId === organizationId)),
}));

const { jotformReadOptionsFor } = await import('./jotformReadCredentials');

const MANORS = 'managed-cremations';
const GUS = 'gus-camacho-jr';
const THIRD = 'evergreen-memorial-group';
const FORM = 'form-fictional-arrangement';
const row = (organizationId: string, apiKeyReference?: string | null, externalFormId = FORM) =>
  ({ id: `${organizationId}-${externalFormId}-${rows.length}`, organizationId, provider: 'jotform', externalFormId, apiKeyReference }) as unknown as ExternalFormConfig;
const sub = (organizationId: string, externalFormId = FORM) => ({ organizationId, provider: 'jotform', externalFormId });

beforeEach(() => {
  rows.length = 0;
});

describe('jotformReadOptionsFor', () => {
  it('Manors reads exactly as before: the original key, unless its own row names another', async () => {
    expect(await jotformReadOptionsFor(MANORS, sub(MANORS), 'mock')).toEqual({ apiKeyReference: 'JOTFORM_API_KEY' });
    rows.push(row(MANORS, null));
    expect(await jotformReadOptionsFor(MANORS, sub(MANORS), 'mock')).toEqual({ apiKeyReference: 'JOTFORM_API_KEY' });
    rows.length = 0;
    rows.push(row(MANORS, 'JOTFORM_API_KEY_MANORS_ALT'));
    expect(await jotformReadOptionsFor(MANORS, sub(MANORS), 'mock')).toEqual({ apiKeyReference: 'JOTFORM_API_KEY_MANORS_ALT' });
  });

  it('Gus reads only with the key its own form row names', async () => {
    rows.push(row(GUS, 'JOTFORM_API_KEY_GUS'));
    expect(await jotformReadOptionsFor(GUS, sub(GUS), 'mock')).toEqual({ apiKeyReference: 'JOTFORM_API_KEY_GUS' });
  });

  it('fails closed — never the original key — for any other home without its own key', async () => {
    for (const org of [GUS, THIRD]) {
      rows.length = 0;
      expect(await jotformReadOptionsFor(org, sub(org), 'mock'), `${org}: no row`).toBeNull();
      rows.push(row(org, null));
      expect(await jotformReadOptionsFor(org, sub(org), 'mock'), `${org}: row without a key`).toBeNull();
      rows.length = 0;
      rows.push(row(org, 'JOTFORM_API_KEY'));
      expect(await jotformReadOptionsFor(org, sub(org), 'mock'), `${org}: naming the original key`).toBeNull();
      rows.length = 0;
      rows.push(row(org, 'WIX_API_KEY'));
      expect(await jotformReadOptionsFor(org, sub(org), 'mock'), `${org}: not a JotForm key name`).toBeNull();
      rows.length = 0;
      rows.push(row(org, 'JOTFORM_API_KEY_A'), row(org, 'JOTFORM_API_KEY_B'));
      expect(await jotformReadOptionsFor(org, sub(org), 'mock'), `${org}: ambiguous rows`).toBeNull();
    }
  });

  it("never reads another organization's submission, nor with another organization's row", async () => {
    rows.push(row(GUS, 'JOTFORM_API_KEY_GUS'), row(MANORS, 'JOTFORM_API_KEY_MANORS_ALT'));
    expect(await jotformReadOptionsFor(GUS, sub(MANORS), 'mock')).toBeNull();
    expect(await jotformReadOptionsFor(MANORS, sub(GUS), 'mock')).toBeNull();
    expect(await jotformReadOptionsFor(THIRD, sub(THIRD), 'mock')).toBeNull();
  });

  it('only JotForm submissions', async () => {
    expect(await jotformReadOptionsFor(MANORS, { ...sub(MANORS), provider: 'other' }, 'mock')).toBeNull();
  });
});
