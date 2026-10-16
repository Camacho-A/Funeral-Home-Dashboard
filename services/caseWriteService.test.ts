import { beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { standardCremationWorkflowTemplateFixture } from './__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot, latestTemplateVersion } from '../domain/workflow/snapshot';
import { buildWixCaseData } from '../lib/wixCaseMapper';

/**
 * Case concurrency (2026-10). The central case write path, against an
 * in-memory Wix `cases` collection that applies conditions the way Wix does:
 * a PatchDataItem whose `condition.filter` no longer matches is refused with
 * HTTP 428 and writes nothing; `$eq: null` matches an absent field.
 */

type Row = { id: string; data: Record<string, unknown> };
let rows: Row[] = [];
let patchCalls: { id: string; fields: Record<string, unknown>; condition: { filter: Record<string, { $eq: unknown }> } }[] = [];
/** Lets a test land a competing write between a read and a patch. */
let beforePatch: ((callIndex: number) => void) | null = null;
let failNextPatchResponse = false;

vi.mock('../lib/wixDataApi', () => ({
  queryWixDataItems: async (collectionId: string, query: { filter: Record<string, unknown> }) => {
    if (collectionId !== 'cases') return { dataItems: [] };
    const matches = rows.filter((row) => Object.entries(query.filter).every(([key, value]) => row.data[key] === value));
    return { dataItems: matches.map((row) => ({ id: row.id, dataCollectionId: 'cases', data: { ...row.data } })) };
  },
  conditionalPatchWixDataItemFields: async (
    _collectionId: string,
    id: string,
    fields: Record<string, unknown>,
    condition: { filter: Record<string, { $eq: unknown }> },
  ) => {
    patchCalls.push({ id, fields, condition });
    beforePatch?.(patchCalls.length - 1);
    const row = rows.find((r) => r.id === id);
    if (!row) return { applied: false, status: 404 };
    const ok = Object.entries(condition.filter).every(([key, test]) => (row.data[key] ?? null) === test.$eq);
    if (!ok) return { applied: false, status: 428 };
    row.data = { ...row.data, ...fields };
    if (failNextPatchResponse) {
      failNextPatchResponse = false;
      throw new Error('socket hang up');
    }
    return { applied: true, dataItem: { id, dataCollectionId: 'cases', data: { ...row.data } } };
  },
}));

const { writeCaseFields, updateCaseWithRetry, loadCaseRow, CASE_WRITE_MAX_ATTEMPTS } = await import('./caseWriteService');
const { buildCaseFieldPatch } = await import('../lib/wixCaseMapper');

const ORG = 'managed-cremations';

function seedRow(id: string, overrides: Record<string, unknown> = {}, organizationId = ORG): Row {
  const template = standardCremationWorkflowTemplateFixture;
  const version = latestTemplateVersion(template);
  const base = caseFixtures[0];
  const data = buildWixCaseData({
    ...base,
    beaconCaseId: id,
    organizationId,
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    caseType: 'cremation',
    workflowSnapshot: buildCaseWorkflowSnapshot(template, version),
  } as never) as Record<string, unknown>;
  const row = { id, data: { ...data, ...overrides } };
  rows.push(row);
  return row;
}

beforeEach(() => {
  rows = [];
  patchCalls = [];
  beforePatch = null;
  failNextPatchResponse = false;
});

describe('writeCaseFields', () => {
  it('a legacy row (no revision) is matched with $eq null and moves to revision 1', async () => {
    seedRow('c1');
    const row = (await loadCaseRow(ORG, 'c1'))!;
    expect(row.data.revision).toBeUndefined();

    const result = await writeCaseFields(row, buildCaseFieldPatch(row.data, { weight: '180 LB' }));

    expect(result.result).toBe('applied');
    expect(patchCalls[0].condition.filter).toEqual({
      organizationId: { $eq: ORG },
      beaconCaseId: { $eq: 'c1' },
      revision: { $eq: null },
    });
    expect(rows[0].data.revision).toBe(1);
  });

  it('is FIELD-SCOPED: sets only the changed field and the revision, never the whole row', async () => {
    seedRow('c1', { revision: 3 });
    const row = (await loadCaseRow(ORG, 'c1'))!;
    await writeCaseFields(row, buildCaseFieldPatch(row.data, { weight: '180 LB' }));
    expect(Object.keys(patchCalls[0].fields).sort()).toEqual(['revision', 'weight']);
    expect(patchCalls[0].fields.revision).toBe(4);
  });

  it('a write against a stale read is refused (conflict) and changes nothing', async () => {
    seedRow('c1', { revision: 2 });
    const stale = (await loadCaseRow(ORG, 'c1'))!;
    rows[0].data = { ...rows[0].data, placeOfDeath: 'HOSPITAL', revision: 3 }; // someone else saved

    const result = await writeCaseFields(stale, buildCaseFieldPatch(stale.data, { placeOfDeath: 'HOME' }));

    expect(result.result).toBe('conflict');
    expect(rows[0].data.placeOfDeath).toBe('HOSPITAL');
    expect(rows[0].data.revision).toBe(3);
  });

  it('a lost response after the patch applied is reported as applied, not failed', async () => {
    seedRow('c1', { revision: 1 });
    const row = (await loadCaseRow(ORG, 'c1'))!;
    failNextPatchResponse = true;
    const result = await writeCaseFields(row, buildCaseFieldPatch(row.data, { weight: '190 LB' }));
    expect(result.result).toBe('applied');
    expect(rows[0].data.weight).toBe('190 LB');
  });

  it('can never write another organization\'s row: the condition pins organizationId', async () => {
    seedRow('c1', {}, 'gus-camacho-jr');
    expect(await loadCaseRow(ORG, 'c1')).toBeNull();
    const forged = { id: 'c1', data: { ...rows[0].data, organizationId: ORG } };
    const result = await writeCaseFields(forged as never, { weight: 'X' });
    expect(result.result).not.toBe('applied');
    expect(rows[0].data.weight).not.toBe('X');
  });
});

describe('updateCaseWithRetry (server-side writers)', () => {
  it('re-reads and re-decides after losing to a concurrent write, keeping BOTH changes', async () => {
    seedRow('c1', { revision: 0, checklistState: {} });
    // A staff tick lands between the writer's read and its patch.
    beforePatch = (index) => {
      if (index === 0) rows[0].data = { ...rows[0].data, checklistState: { '0:3': true }, revision: 1 };
    };

    const result = await updateCaseWithRetry(ORG, 'c1', (row) =>
      buildCaseFieldPatch(row.data, { paymentStatus: 'paid_in_full', checklistState: { '0:8': true } }),
    );

    expect(result.result).toBe('applied');
    expect(patchCalls).toHaveLength(2);
    expect(rows[0].data.checklistState).toEqual({ '0:3': true, '0:8': true });
    expect(rows[0].data.paymentStatus).toBe('paid_in_full');
    expect(rows[0].data.revision).toBe(2);
  });

  it('is BOUNDED: gives up with conflict after CASE_WRITE_MAX_ATTEMPTS, never loops forever', async () => {
    seedRow('c1', { revision: 0 });
    beforePatch = () => {
      rows[0].data = { ...rows[0].data, revision: (rows[0].data.revision as number) + 1 };
    };
    const result = await updateCaseWithRetry(ORG, 'c1', (row) => buildCaseFieldPatch(row.data, { weight: 'Y' }));
    expect(result.result).toBe('conflict');
    expect(patchCalls).toHaveLength(CASE_WRITE_MAX_ATTEMPTS);
  });

  it('writes nothing when the decision is already true (idempotent retries / redeliveries)', async () => {
    seedRow('c1', { revision: 5, paymentStatus: 'paid_in_full' });
    const result = await updateCaseWithRetry(ORG, 'c1', (row) => buildCaseFieldPatch(row.data, { paymentStatus: 'paid_in_full' }));
    expect(result.result).toBe('unchanged');
    expect(patchCalls).toHaveLength(0);
    expect(rows[0].data.revision).toBe(5);
  });

  it('a missing case is not_found, with no write', async () => {
    const result = await updateCaseWithRetry(ORG, 'nope', () => ({ weight: 'Z' }));
    expect(result.result).toBe('not_found');
    expect(patchCalls).toHaveLength(0);
  });
});

describe('buildCaseFieldPatch — map fields merge per key', () => {
  it('a one-key checklist patch keeps every other key as it is NOW (no stale-map erase)', () => {
    const current = { checklistState: { '0:8': true, '0:3': true } } as never;
    const fields = buildCaseFieldPatch(current, { checklistState: { '0:4': true } });
    expect(fields.checklistState).toEqual({ '0:8': true, '0:3': true, '0:4': true });
  });

  it('a stale WHOLE map from an old client cannot remove a key added since', () => {
    const current = { checklistState: { '0:8': true } } as never; // payment ticked server-side
    const fields = buildCaseFieldPatch(current, { checklistState: { '0:3': true } });
    expect((fields.checklistState as Record<string, boolean>)['0:8']).toBe(true);
  });
});
